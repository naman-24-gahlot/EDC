// Every write to a person record must stamp `touchedAt` (`...personTouched()`), or the Master's
// lists (lib/people/peopleIndex.ts) could miss the change until the hourly rebuild. This reads the
// source and fails on a person write without it. If it flags something that isn't a person
// record, add `// not a person record` on that line. It can't see writes through a variable
// (`ref`, `d.ref`) — stamp those by hand; the index's hourly rebuild is the backstop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
});

// A write call whose target is a person record: people.doc(…), collection('people').doc(…), personRef.
const PERSON_WRITE = /\.(update|create|set)\(\s*(adminDb\.collection\('people'\)\.doc\(|people\.doc\(|personRef\b)|(collection\('people'\)|people)\.doc\([^)]*\)\.(update|create|set)\(/;

test('every write to a person record stamps touchedAt', () => {
  const missing: string[] = [];
  for (const f of [...files('app'), ...files('lib')]) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!PERSON_WRITE.test(line) || line.includes('profileHistory') || line.includes('// not a person record')) return;
      // The statement can run over a few lines (an object literal).
      const statement = lines.slice(i, i + 12).join('\n');
      const end = statement.indexOf(');');
      if (!(end === -1 ? statement : statement.slice(0, end)).includes('personTouched()')) missing.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(missing, [], `Person writes without ...personTouched(): ${missing.join(', ')}`);
});
