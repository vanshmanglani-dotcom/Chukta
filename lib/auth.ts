import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { db, type Org } from './db';

const COOKIE = 'chukta_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return new TextEncoder().encode(s);
}

export interface Session {
  uid: string;
  oid: string;
  email: string;
}

export async function createSession(s: Session): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: String(payload.uid), oid: String(payload.oid), email: String(payload.email) };
  } catch {
    return null;
  }
}

/** For pages and server actions: returns the session + org or redirects to /login. */
export async function requireOrg(): Promise<{ session: Session; org: Org }> {
  const session = await getSession();
  if (!session) redirect('/login');
  const rows = (await db()`SELECT * FROM orgs WHERE id = ${session.oid}`) as Org[];
  if (!rows[0]) redirect('/login');
  return { session, org: rows[0] };
}
