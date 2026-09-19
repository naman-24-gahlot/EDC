'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const PROFILE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'incubee', label: 'Incubee' },
  { value: 'event_guest', label: 'Event Guest' },
  { value: 'driver', label: 'Driver' },
  { value: 'relative', label: 'Relative' },
  { value: 'bodyguard', label: 'Bodyguard' },
] as const;

const SUBORDINATE_TYPES = new Set(['driver', 'relative', 'bodyguard', 'event_guest']);
const MAX_PHOTO_DIMENSION = 256;

async function downscalePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [commEmail, setCommEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [purpose, setPurpose] = useState('');
  const [profileType, setProfileType] = useState<string>('employee');
  const [parentIdentifier, setParentIdentifier] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const needsParent = SUBORDINATE_TYPES.has(profileType);

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    try {
      setPhotoDataUrl(await downscalePhoto(file));
    } catch {
      setPhotoError('Could not process that photo — try a different image.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          username,
          commEmail,
          mobile,
          password,
          purpose,
          profileType,
          parentIdentifier: needsParent ? parentIdentifier : undefined,
          photoDataUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Registration failed');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-sm space-y-4 px-4 py-12 text-center">
        <h1 className="text-lg font-semibold">Registration submitted</h1>
        <p className="text-sm text-gray-500">
          Your registration is pending approval. You&apos;ll be able to sign in once an
          authorized approver approves it.
        </p>
        <button
          onClick={() => router.push('/login')}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white"
        >
          Go to sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">EDC Registration</h1>
        <p className="text-sm text-gray-500">
          Register once — your profile stays even if access later expires.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={firstName} onChange={setFirstName} required />
          <Field label="Last name" value={lastName} onChange={setLastName} required />
        </div>
        <Field
          label="Username"
          value={username}
          onChange={setUsername}
          required
          placeholder="letters, numbers, . _ -"
        />
        <Field
          label="Communication email"
          type="email"
          value={commEmail}
          onChange={setCommEmail}
          required
        />
        <Field label="Mobile number" value={mobile} onChange={setMobile} required />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          required
          placeholder="at least 8 characters"
        />

        <div className="space-y-1">
          <label className="text-sm font-medium">Profile / Purpose</label>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
            rows={2}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Profile type</label>
          <select
            value={profileType}
            onChange={(e) => setProfileType(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {PROFILE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {needsParent && (
          <Field
            label="Controlling employee's username or access code"
            value={parentIdentifier}
            onChange={setParentIdentifier}
            required
            placeholder="e.g. rahul or EDC25166"
          />
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">Profile photo (optional)</label>
          <input type="file" accept="image/*" onChange={handlePhotoChange} className="text-sm" />
          {photoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL preview, not a static/remote asset
            <img
              src={photoDataUrl}
              alt="Preview"
              className="mt-2 h-16 w-16 rounded-full object-cover"
            />
          )}
          {photoError && <p className="text-sm text-red-600">{photoError}</p>}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Submitting…' : 'Submit registration'}
        </button>
      </form>
    </main>
  );
}
