// SERVER-ONLY. The app's own emails (approval summaries, visitor passes, stay alerts, backup-email
// password resets) — DEPLOYMENT.md "Emails". Firebase only sends its own fixed templates, so these
// go out through any SMTP account; a free Gmail account with an app password is enough
// (~500 emails a day). Written on Node's built-in TLS socket: no mail library.
//
//   SMTP_USER  the sending address (e.g. edc.access@gmail.com)
//   SMTP_PASS  its app password (Google account → Security → App passwords)
//   SMTP_HOST / SMTP_PORT  optional, default smtp.gmail.com:465 (implicit TLS)
//
// Test addresses (…@anything.test) never leave: the message lands in /admin/outbox. Real
// addresses with SMTP not set up are skipped. Every attempt is written to `emailLog`, so a Master
// can see what went out and what didn't. A failure never fails the action that triggered it.
if (typeof window !== 'undefined') {
  throw new Error('lib/mail.ts must never be imported into client code.');
}

import { connect, type TLSSocket } from 'tls';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { isTestAddress } from '@/lib/auth/emailActions';

export type MailKind =
  | 'REGISTRATION_APPROVED' | 'REGISTRATION_REJECTED' | 'ACCESS_APPROVED' | 'VISITOR_PASS'
  | 'VISITOR_ARRIVED' | 'STAY_ALERT' | 'LEAVE_DECIDED' | 'PASSWORD_RESET_BACKUP' | 'PASSWORD_RESET' | 'VERIFY_EMAIL' | 'EVENT_PASS';

export interface Mail {
  kind: MailKind;
  /** Who it's about (for the log); null for none. */
  personId: string | null;
  to: (string | null | undefined)[];
  subject: string;
  /** Plain text. Lines are kept as written; a URL on its own line is clickable in every client. */
  text: string;
  /** Files sent with it (e.g. the pass as a PDF). */
  attachments?: { filename: string; contentType: string; data: Buffer }[];
}

// Same rule as sign-up: nothing that could break out of an SMTP command or header (<, >, commas, spaces).
const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export type Delivery = 'sent' | 'outbox' | 'skipped' | 'failed';

export const mailConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/** Sends to each distinct address; returns what happened per address. Never throws. */
export async function sendMail(mail: Mail): Promise<Record<string, Delivery>> {
  const to = [...new Set(mail.to.filter((x): x is string => !!x && ADDRESS_RE.test(x) && x.length <= 254).map((x) => x.toLowerCase()))];
  const out: Record<string, Delivery> = {};
  const now = Timestamp.now();
  for (const addr of to) {
    let status: Delivery;
    let error: string | null = null;
    try {
      if (isTestAddress(addr)) {
        await adminDb.collection('testOutbox').add({ personId: mail.personId, to: addr, kind: mail.kind, subject: mail.subject, text: mail.text, link: firstUrl(mail.text), attachments: (mail.attachments ?? []).map((a) => a.filename), createdAt: now });
        status = 'outbox';
      } else if (!mailConfigured()) {
        status = 'skipped';
      } else {
        await smtpSend(addr, mail.subject, mail.text, mail.attachments ?? []);
        status = 'sent';
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
      console.error('Email failed', mail.kind, err);
    }
    out[addr] = status;
    await adminDb.collection('emailLog').add({ kind: mail.kind, personId: mail.personId, to: addr, subject: mail.subject, status, error, at: now }).catch(() => {});
  }
  return out;
}

const firstUrl = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? null;

// ——— SMTP (RFC 5321) over implicit TLS ———

/** "=?UTF-8?B?…?=" so names and dashes survive in headers. */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');

/** The MIME body: plain text, or multipart/mixed with the attachments (everything base64). */
function mimeBody(text: string, attachments: NonNullable<Mail['attachments']>): string[] {
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))];
  if (attachments.length === 0) return textPart;
  const b = `edc-${randomBytes(12).toString('hex')}`;
  return [`Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, ...textPart,
    ...attachments.flatMap((a) => [`--${b}`, `Content-Type: ${a.contentType}; name="${a.filename}"`, `Content-Disposition: attachment; filename="${a.filename}"`, 'Content-Transfer-Encoding: base64', '', wrap76(a.data.toString('base64'))]),
    `--${b}--`];
}

function smtpSend(to: string, subject: string, text: string, attachments: NonNullable<Mail['attachments']>): Promise<void> {
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASS!;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const fromName = process.env.MAIL_FROM_NAME || 'EDC Access';
  const message = [
    `From: ${header(fromName)} <${user}>`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${user.split('@')[1]}>`,
    'MIME-Version: 1.0',
    ...mimeBody(text, attachments),
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const socket: TLSSocket = connect({ host, port, servername: host });
    socket.setTimeout(15_000, () => socket.destroy(new Error('SMTP timed out')));
    let buffer = '';
    let waiting: ((reply: { code: number; text: string }) => void) | null = null;
    socket.setEncoding('utf8');
    // A reply is complete at a line "NNN text" (a "NNN-" line means more follow).
    const drain = () => {
      const lines = buffer.split('\r\n');
      const last = lines.findIndex((l) => /^\d{3} /.test(l));
      if (last === -1 || !waiting) return;
      const reply = lines.slice(0, last + 1);
      buffer = lines.slice(last + 1).join('\r\n');
      const w = waiting; waiting = null;
      w({ code: Number(reply[last].slice(0, 3)), text: reply.join(' ') });
    };
    socket.on('data', (chunk: string) => { buffer += chunk; drain(); });
    socket.on('error', reject);
    const expect = (want: number) => new Promise<void>((ok, bad) => {
      waiting = (r) => (r.code === want ? ok() : bad(new Error(`SMTP ${r.text}`)));
      drain();
    });
    const send = (line: string, want: number) => { const p = expect(want); socket.write(`${line}\r\n`); return p; };

    (async () => {
      await expect(220);
      await send(`EHLO edc-access`, 250);
      await send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, 235);
      await send(`MAIL FROM:<${user}>`, 250);
      await send(`RCPT TO:<${to}>`, 250);
      await send('DATA', 354);
      // Dot-stuffing isn't needed: the body is base64, which never starts a line with ".".
      await send(`${message}\r\n.`, 250);
      socket.write('QUIT\r\n');
      socket.end();
    })().then(resolve, (err) => { socket.destroy(); reject(err); });
  });
}
