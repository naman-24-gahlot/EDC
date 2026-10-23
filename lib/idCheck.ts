// Client-safe. Kinds of photo ID a guard can record as "seen" (type + last 4 only — see
// app/api/guard/id-check). Never the full number, never an image.
export const ID_TYPES = ['Aadhaar', 'PAN card', 'Driving licence', 'Passport', 'Voter ID', 'College / company ID', 'Other'] as const;
export type IdType = (typeof ID_TYPES)[number];
