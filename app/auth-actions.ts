'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { createSession, destroySession } from '@/lib/auth';
import { audit } from '@/lib/audit';

function back(path: string, err: string): never {
  redirect(`${path}?err=${encodeURIComponent(err)}`);
}

export async function signup(form: FormData) {
  const business = String(form.get('business') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  if (!business || !name) back('/signup', 'Business and your name are required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back('/signup', 'Enter a valid email');
  if (password.length < 8) back('/signup', 'Password must be at least 8 characters');

  const sql = db();
  const existing = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (existing.length) back('/signup', 'An account with this email already exists');

  const hash = await bcrypt.hash(password, 10);
  const [org] = await sql`INSERT INTO orgs (name, sender_name) VALUES (${business}, ${name}) RETURNING id`;
  const [user] = await sql`
    INSERT INTO users (org_id, email, name, password_hash) VALUES (${org.id}, ${email}, ${name}, ${hash}) RETURNING id`;
  await audit(org.id, `user:${email}`, 'org.created');
  await createSession({ uid: user.id, oid: org.id, email });
  redirect('/settings?msg=' + encodeURIComponent('Welcome! Add your UPI ID first so buyers can pay you.'));
}

export async function login(form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const rows = await db()`SELECT id, org_id, password_hash FROM users WHERE email = ${email}`;
  const ok = rows[0] && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) back('/login', 'Wrong email or password');
  await createSession({ uid: rows[0].id, oid: rows[0].org_id, email });
  redirect('/dashboard');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}
