import test from 'node:test';
import assert from 'node:assert/strict';

// crypto.ts reads its key from lib/env.ts, which validates process.env at
// import time — set the required vars and import dynamically so this file
// runs standalone (no .env needed) regardless of import order.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_JWT_SECRET ??= 'test-secret';
process.env.PUBLIC_APP_URL ??= 'http://localhost:3000';

const { encryptSecret, decryptSecret } = await import('./crypto.js');

void test('decryptSecret reverses encryptSecret', () => {
  const plaintext = 'super-secret-asana-access-token';
  const ciphertext = encryptSecret(plaintext);
  assert.equal(decryptSecret(ciphertext), plaintext);
});

void test('encrypting the same plaintext twice produces different ciphertext (random IV)', () => {
  const a = encryptSecret('same-value');
  const b = encryptSecret('same-value');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), 'same-value');
  assert.equal(decryptSecret(b), 'same-value');
});

void test('tampered ciphertext fails to decrypt instead of silently returning garbage', () => {
  const ciphertext = encryptSecret('secret-value');
  const buf = Buffer.from(ciphertext, 'base64');
  buf[buf.length - 1] ^= 0xff; // flip the last byte of the actual ciphertext
  const tampered = buf.toString('base64');
  assert.throws(() => decryptSecret(tampered));
});

void test('handles unicode plaintext (e.g. task titles with "∑")', () => {
  const plaintext = 'Rollup task [∑5,5] — client André';
  assert.equal(decryptSecret(encryptSecret(plaintext)), plaintext);
});
