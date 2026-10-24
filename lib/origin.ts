// SERVER-ONLY. This site's own origin (https://host), for links we send or show.
//
// Links in emails (password reset, approval, visitor pass) must never point at a host taken from
// an untrusted request header — that's "reset-link poisoning". So the request's host is used only
// when it's one we know: the hosts in APP_HOSTS, this deployment's own Vercel URLs, or localhost.
// Anything else gets APP_ORIGIN (the canonical address).
import { headers } from 'next/headers';

const DEFAULT_ORIGIN = 'https://edc-gib-24.vercel.app';
const KNOWN_HOSTS = ['edc-gib-24.vercel.app', 'edc-neon.vercel.app'];

function allowedHosts(): Set<string> {
  const list = (process.env.APP_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  // Vercel sets these for each deployment (the deployment's own URL and its branch alias).
  for (const v of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) if (v) list.push(v.toLowerCase());
  return new Set([...KNOWN_HOSTS, ...list]);
}

export function canonicalOrigin(): string {
  return (process.env.APP_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
}

export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').toLowerCase();
  if (/^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host) && process.env.NODE_ENV !== 'production') return `http://${host}`;
  if (allowedHosts().has(host)) return `https://${host}`;
  return canonicalOrigin();
}
