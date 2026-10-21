'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';

// Public, unauthenticated actions for buyers. Every one of them can only STOP reminders, never start them.

function valid(token: string): boolean {
  return /^[a-f0-9]{32}$/.test(token);
}

async function load(token: string) {
  if (!valid(token)) return null;
  const rows = await db()`SELECT id, org_id, buyer_id, status FROM invoices WHERE public_token = ${token}`;
  return rows[0] ?? null;
}

export async function claimPaid(form: FormData) {
  const token = String(form.get('token'));
  const inv = await load(token);
  if (!inv) redirect('/');
  const ref = String(form.get('reference') ?? '').trim().slice(0, 100);
  const sql = db();
  await sql`UPDATE invoices SET status = 'payment_claimed' WHERE id = ${inv.id} AND status IN ('open','paused')`;
  await sql`UPDATE reminders SET status = 'cancelled', hold_reason = 'Buyer says paid' WHERE invoice_id = ${inv.id} AND status IN ('pending_approval','queued','held')`;
  await audit(inv.org_id, `buyer:${token.slice(0, 8)}`, 'invoice.payment_claimed', 'invoice', inv.id, { reference: ref });
  redirect(`/p/${token}?done=paid`);
}

export async function raiseDispute(form: FormData) {
  const token = String(form.get('token'));
  const inv = await load(token);
  if (!inv) redirect('/');
  const reason = String(form.get('reason') ?? '').trim().slice(0, 500) || 'No reason given';
  const sql = db();
  await sql`UPDATE invoices SET status = 'disputed', dispute_reason = ${reason} WHERE id = ${inv.id} AND status IN ('open','paused','payment_claimed')`;
  await sql`UPDATE reminders SET status = 'cancelled', hold_reason = 'Buyer raised a dispute' WHERE invoice_id = ${inv.id} AND status IN ('pending_approval','queued','held')`;
  await audit(inv.org_id, `buyer:${token.slice(0, 8)}`, 'invoice.disputed', 'invoice', inv.id, { reason });
  redirect(`/p/${token}?done=dispute`);
}

export async function optOut(form: FormData) {
  const token = String(form.get('token'));
  const inv = await load(token);
  if (!inv) redirect('/');
  const sql = db();
  await sql`UPDATE buyers SET opted_out_at = COALESCE(opted_out_at, now()) WHERE id = ${inv.buyer_id}`;
  await sql`UPDATE reminders SET status = 'cancelled', hold_reason = 'Buyer opted out' WHERE buyer_id = ${inv.buyer_id} AND status IN ('pending_approval','queued','held')`;
  await audit(inv.org_id, `buyer:${token.slice(0, 8)}`, 'buyer.opted_out', 'buyer', inv.buyer_id);
  redirect(`/p/${token}?done=optout`);
}
