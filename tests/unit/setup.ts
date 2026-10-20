// Imported first by every unit test. Gives the Firebase Admin SDK a throwaway, locally
// generated service-account key so modules that import it can load offline — the unit tests
// only exercise pure functions and never make a network call. No real credentials needed.
import { generateKeyPairSync } from 'crypto';

if (!process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_ADMIN_PROJECT_ID = 'unit-test-project';
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'unit-test@unit-test-project.iam.gserviceaccount.com';
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
process.env.QR_TOKEN_SECRET ??= 'unit-test-secret-not-used-anywhere-else-0123456789abcdef';
