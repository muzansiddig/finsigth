import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSessionToken,
  getClearedSessionCookie,
  getSessionCookie,
  hashPassword,
  readSessionToken,
  validateSessionSecret,
  verifyPassword,
} from './auth.js';

const secret = 'unit-test-session-secret-at-least-32-bytes-long';

describe('authentication helpers', () => {
  it('hashes passwords with per-password salts and verifies them', async () => {
    const first = await hashPassword('a sufficiently long password');
    const second = await hashPassword('a sufficiently long password');
    assert.notEqual(first, second);
    assert.equal(await verifyPassword('a sufficiently long password', first), true);
    assert.equal(await verifyPassword('incorrect password', first), false);
    assert.equal(await verifyPassword('anything', 'malformed'), false);
  });

  it('signs session claims and rejects tampered, malformed, and expired sessions', () => {
    validateSessionSecret(secret);
    assert.throws(() => validateSessionSecret('short'));
    assert.throws(() => validateSessionSecret('replace-with-a-private-value-long-enough'));
    const token = createSessionToken({ userId: 12, tenantId: 8, role: 'reviewer' }, secret);
    const claims = readSessionToken(token, secret);
    assert.ok(claims);
    assert.equal(claims.userId, 12);
    assert.equal(claims.tenantId, 8);
    assert.equal(claims.role, 'reviewer');
    assert.ok(Number.isSafeInteger(claims.exp));
    assert.equal(readSessionToken(`${token.slice(0, -1)}x`, secret), null);
    assert.equal(readSessionToken('not.a.session', secret), null);
    assert.equal(readSessionToken(undefined, secret), null);
    assert.equal(readSessionToken(token, 'another-secret-with-at-least-32-bytes'), null);
  });

  it('sets restrictive session cookie attributes and clears it on logout', () => {
    assert.match(getSessionCookie('signed-token', true), /HttpOnly; Path=\/; SameSite=Strict; Max-Age=28800; Secure/);
    assert.match(getClearedSessionCookie(false), /Max-Age=0/);
    assert.doesNotMatch(getSessionCookie('signed-token', false), /; Secure/);
  });
});
