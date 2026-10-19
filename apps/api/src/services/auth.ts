import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const scrypt = promisify(scryptCallback);
const sessionCookieName = 'finsight_session';
const sessionDurationSeconds = 8 * 60 * 60;

export const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export type SessionClaims = {
  userId: number;
  tenantId: number;
  role: 'admin' | 'reviewer' | 'viewer';
  exp: number;
};

export function validateSessionSecret(secret: string | undefined) {
  if (!secret || Buffer.byteLength(secret) < 32 || secret.toLowerCase().includes('replace-with')) {
    throw new Error('SESSION_SECRET must be a private value containing at least 32 bytes.');
  }
  return secret;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(hashHex)) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(claims: Omit<SessionClaims, 'exp'>, secret: string) {
  const payload = Buffer.from(JSON.stringify({
    ...claims,
    exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
  })).toString('base64url');
  const content = `v1.${payload}`;
  return `${content}.${sign(content, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string): SessionClaims | null {
  if (!token) return null;
  const [version, payload, signature, extra] = token.split('.');
  if (version !== 'v1' || !payload || !signature || extra) return null;

  const content = `${version}.${payload}`;
  const expected = Buffer.from(sign(content, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (
      !Number.isSafeInteger(parsed.userId) ||
      !Number.isSafeInteger(parsed.tenantId) ||
      !['admin', 'reviewer', 'viewer'].includes(parsed.role) ||
      !Number.isSafeInteger(parsed.exp) ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSessionCookie(token: string, secure: boolean) {
  return `${sessionCookieName}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${sessionDurationSeconds}${secure ? '; Secure' : ''}`;
}

export function getClearedSessionCookie(secure: boolean) {
  return `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === sessionCookieName) return value.join('=');
  }
  return undefined;
}
