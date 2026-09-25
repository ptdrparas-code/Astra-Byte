const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(scryptCallback);

function generateTemporaryPassword() {
  // Base64url is SMS-friendly and does not contain whitespace.
  return randomBytes(12).toString('base64url');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, encodedSalt, encodedKey] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;

  const salt = Buffer.from(encodedSalt, 'base64url');
  const expectedKey = Buffer.from(encodedKey, 'base64url');
  const actualKey = await scrypt(password, salt, expectedKey.length);
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
}

module.exports = { generateTemporaryPassword, hashPassword, verifyPassword };
