'use server';

import Papa from 'papaparse';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db, type Org } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { env, getGlobalKill } from '@/lib/config';
import { draftReminder } from '@/lib/ai';
import { sendEmail } from '@/lib/email';
import { formatINR, parseRupeesToPaise } from '@/lib/money';
import { daysBetween, istHour, istToday, toDateStr } from '@/lib/time';
import { normalizePhone, payPageUrl, whatsappLink } from '@/lib/links';
import { checkDraft } from '@/lib/engine/guardrails';
import { composeMessage } from '@/lib/engine/compose';
import { legalMentionAllowed, runEngine } from '@/lib/engine/run';
import type { Stage } from '@/lib/engine/ladder';

function go(path: string, msg?: string, err?: string): never {
  const q = new URLSearchParams();
  if (msg) q.set('msg', msg);
  if (err) q.set('err', err);
  const s = q.toString();
  redirect(s ? `${path}?${s}` : path);
}

async function killReason(org: Org): Promise<string | null> {
  if (env.envKill() || (await getGlobalKill())) return 'Platform kill switch is ON — nothing can be sent right now.';
  const [fresh] = await db()`SELECT kill_switch FROM orgs WHERE id = ${org.id}`;
  if (fresh?.kill_switch) return 'Your kill switch is ON. Turn it off on the dashboard to send.';
  return null;
}

// ---------- Kill switch & engine ----------

export async function toggleKill() {
  const { org, session } = await requireOrg();
  const next = !org.kill_switch;
  await db()`UPDATE orgs SET kill_switch = ${next} WHERE id = ${org.id}`;
  if (next) {
    // Stop anything waiting to auto-send right now.
    await db()`UPDATE reminders SET hold_reason = 'Kill switch turned on' WHERE org_id = ${org.id} AND status = 'queued'`;
  }
  await audit(org.id, `user:${session.email}`, next ? 'kill_switch.on' : 'kill_switch.off');
  revalidatePath('/', 'layout');
  go('/dashboard', next ? 'Kill switch ON — all reminders stopped.' : 'Kill switch OFF — reminders resume on the next run.');
}

export async function runNow() {
  const { org, session } = await requireOrg();
  if (org.kill_switch) go('/dashboard', undefined, 'Kill switch is ON. Turn it off first.');
  const stats = await runEngine({ orgId: org.id, actor: `user:${session.email}` });
  await audit(org.id, `user:${session.email}`, 'engine.run_now', 'org', org.id, { ...stats });
  const summary = stats.aborted
    ? `Stopped: ${stats.aborted}`
    : `Drafted ${stats.drafted} (${stats.pendingApproval} need you, ${stats.held} held) · sent ${stats.sent} · deferred ${stats.deferred}`;
  go('/queue', summary);
}

// ---------- Reminder queue ----------

async function loadReminder(orgId: string, id: string) {
  const rows = await db()`
    SELECT r.*, i.invoice_no, i.public_token, i.status AS invoice_status, i.amount_paise, i.paid_paise, i.due_date,
           b.name AS buyer_name, b.contact_name, b.phone, b.email, b.language,
           b.do_not_contact, b.opted_out_at, b.paused_until
    FROM reminders r JOIN invoices i ON i.id = r.invoice_id JOIN buyers b ON b.id = r.buyer_id
    WHERE r.id = ${id} AND r.org_id = ${orgId}`;
  return rows[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buyerBlocked(r: Record<string, any>): boolean {
  return r.do_not_contact || Boolean(r.opted_out_at) || (r.paused_until !== null && toDateStr(r.paused_until) >= istToday());
}

export async function approveEmail(form: FormData) {
  const { org, session } = await requireOrg();
  const r = await loadReminder(org.id, String(form.get('id')));
  if (!r || !['pending_approval', 'queued'].includes(r.status)) go('/queue', undefined, 'Reminder not found or already handled');
  const blocked = await killReason(org);
  if (blocked) go('/queue', undefined, blocked);
  if (r.invoice_status !== 'open') go('/queue', undefined, 'Invoice is no longer open — reminder not sent');
  if (buyerBlocked(r)) go('/queue', undefined, 'Buyer is paused or opted out — reminder not sent');
  if (!r.email) go('/queue', undefined, 'This buyer has no email address');
  const hour = istHour();
  if (hour < org.quiet_start_hour || hour >= org.quiet_end_hour) {
    go('/queue', undefined, `Outside sending hours (${org.quiet_start_hour}:00–${org.quiet_end_hour}:00 IST). Try again then.`);
  }
  if (env.dryRun()) go('/queue', undefined, 'Dry-run mode is on: nothing is sent.');
  if (!env.emailConfigured()) go('/queue', undefined, 'Email sending is not set up. Use "Copy text" and send it yourself, then mark as sent.');

  const claimed = await db()`UPDATE reminders SET status = 'sent', sent_at = now() WHERE id = ${r.id} AND status IN ('pending_approval','queued') RETURNING id`;
  if (!claimed.length) go('/queue', undefined, 'Already handled');
  const result = await sendEmail({
    to: r.email,
    subject: r.subject || `Payment reminder: invoice ${r.invoice_no}`,
    text: composeMessage(r.body, payPageUrl(r.public_token), 'email'),
  });
  if (!result.ok) {
    await db()`UPDATE reminders SET status = 'pending_approval', sent_at = NULL, error = ${result.error} WHERE id = ${r.id}`;
    go('/queue', undefined, `Send failed: ${result.error}`);
  }
  await audit(org.id, `user:${session.email}`, 'reminder.approved_sent', 'reminder', r.id, { channel: 'email' });
  go('/queue', `Email sent to ${r.buyer_name}`);
}

/** Marks a WhatsApp reminder sent and opens WhatsApp with the text pre-filled. */
export async function sendWhatsApp(form: FormData) {
  const { org, session } = await requireOrg();
  const r = await loadReminder(org.id, String(form.get('id')));
  if (!r || !['pending_approval', 'queued'].includes(r.status)) go('/queue', undefined, 'Reminder not found or already handled');
  const blocked = await killReason(org);
  if (blocked) go('/queue', undefined, blocked);
  if (r.invoice_status !== 'open') go('/queue', undefined, 'Invoice is no longer open');
  if (buyerBlocked(r)) go('/queue', undefined, 'Buyer is paused or opted out');
  const phone = normalizePhone(r.phone);
  if (!phone) go('/queue', undefined, 'This buyer has no valid phone number');

  await db()`UPDATE reminders SET status = 'sent', sent_at = now(), channel = 'whatsapp' WHERE id = ${r.id}`;
  await audit(org.id, `user:${session.email}`, 'reminder.whatsapp_opened', 'reminder', r.id);
  redirect(whatsappLink(phone, composeMessage(r.body, payPageUrl(r.public_token), 'whatsapp')));
}

export async function markSent(form: FormData) {
  const { org, session } = await requireOrg();
  const id = String(form.get('id'));
  const done = await db()`UPDATE reminders SET status = 'sent', sent_at = now() WHERE id = ${id} AND org_id = ${org.id} AND status IN ('pending_approval','queued') RETURNING id`;
  if (done.length) await audit(org.id, `user:${session.email}`, 'reminder.marked_sent', 'reminder', id);
  go('/queue', done.length ? 'Marked as sent' : undefined, done.length ? undefined : 'Already handled');
}

export async function skipReminder(form: FormData) {
  const { org, session } = await requireOrg();
  const id = String(form.get('id'));
  await db()`UPDATE reminders SET status = 'skipped' WHERE id = ${id} AND org_id = ${org.id} AND status IN ('pending_approval','queued','held')`;
  await audit(org.id, `user:${session.email}`, 'reminder.skipped', 'reminder', id);
  go('/queue', 'Skipped');
}

export async function editReminder(form: FormData) {
  const { org, session } = await requireOrg();
  const r = await loadReminder(org.id, String(form.get('id')));
  if (!r || !['pending_approval', 'queued', 'held'].includes(r.status)) go('/queue', undefined, 'Reminder not found');
  const body = String(form.get('body') ?? '').trim();
  const subject = String(form.get('subject') ?? '').trim();
  const outstanding = Number(r.amount_paise) - Number(r.paid_paise);
  const guard = checkDraft({
    stage: r.stage as Stage, channel: r.channel, body, subject: r.channel === 'email' ? subject : undefined,
    invoiceNo: r.invoice_no, amountFormatted: formatINR(outstanding), legalMentionAllowed: legalMentionAllowed(org),
  });
  if (!guard.ok) go('/queue', undefined, `Edit not saved — ${guard.reasons.join('; ')}`);
  // Edited messages always need an explicit send from the owner.
  await db()`UPDATE reminders SET body = ${body}, subject = ${subject || null}, status = 'pending_approval', mode = CASE WHEN mode = 'auto' THEN 'approve' ELSE mode END, hold_reason = 'Edited by you' WHERE id = ${r.id}`;
  await audit(org.id, `user:${session.email}`, 'reminder.edited', 'reminder', r.id);
  go('/queue', 'Saved — review and send when ready');
}

export async function retryDraft(form: FormData) {
  const { org, session } = await requireOrg();
  const r = await loadReminder(org.id, String(form.get('id')));
  if (!r || r.status !== 'held') go('/queue', undefined, 'Only held reminders can be re-drafted');
  const outstanding = Number(r.amount_paise) - Number(r.paid_paise);
  const dueDate = toDateStr(r.due_date);
  try {
    const d = await draftReminder({
      stage: r.stage as Stage, channel: r.channel, language: r.language,
      senderName: org.sender_name, supplierName: org.name, buyerName: r.buyer_name, contactName: r.contact_name,
      invoiceNo: r.invoice_no, amountFormatted: formatINR(outstanding), dueDate,
      daysOverdue: daysBetween(dueDate, istToday()), legalMentionAllowed: legalMentionAllowed(org),
    });
    const guard = checkDraft({
      stage: r.stage as Stage, channel: r.channel, body: d.body, subject: d.subject,
      invoiceNo: r.invoice_no, amountFormatted: formatINR(outstanding), legalMentionAllowed: legalMentionAllowed(org),
    });
    if (!guard.ok) {
      await db()`UPDATE reminders SET body = ${d.body}, subject = ${d.subject}, hold_reason = ${'Safety check failed: ' + guard.reasons.join('; ')} WHERE id = ${r.id}`;
      go('/queue', undefined, 'New draft still failed the safety check. Edit it by hand or skip.');
    }
    // A re-drafted reminder is never auto-sent: the owner looks at it first.
    await db()`UPDATE reminders SET body = ${d.body}, subject = ${d.subject}, ai_model = ${d.model}, status = 'pending_approval', mode = CASE WHEN mode = 'auto' THEN 'approve' ELSE mode END, hold_reason = 'Re-drafted' WHERE id = ${r.id}`;
    await audit(org.id, `user:${session.email}`, 'reminder.redrafted', 'reminder', r.id);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    go('/queue', undefined, `AI still unavailable: ${(err as Error).message.slice(0, 200)}`);
  }
  go('/queue', 'Re-drafted — review it below');
}

// ---------- Invoices ----------

function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY (Indian format)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function validDate(s: string | null): s is string {
  if (!s) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

interface InvoiceRow {
  invoice_no: string; buyer_name: string; amount_paise: number; issue_date: string; due_date: string;
  phone: string | null; email: string | null; language: string; relationship: string;
}

function validateRow(raw: Record<string, string>, line: number): { row?: InvoiceRow; error?: string } {
  const get = (k: string) => String(raw[k] ?? '').trim();
  const invoice_no = get('invoice_no');
  const buyer_name = get('buyer_name');
  const amount = parseRupeesToPaise(get('amount'));
  const issue = parseDate(get('issue_date'));
  const due = parseDate(get('due_date'));
  const email = get('buyer_email').toLowerCase() || null;
  const phoneRaw = get('buyer_phone');
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const language = get('buyer_language').toLowerCase() || 'en';
  const relationship = get('relationship').toLowerCase() || 'regular';
  const errs: string[] = [];
  if (!invoice_no) errs.push('invoice_no missing');
  if (invoice_no.length > 60) errs.push('invoice_no too long');
  if (!buyer_name) errs.push('buyer_name missing');
  if (amount === null) errs.push('amount invalid');
  if (amount !== null && amount > 100_00_00_000_00) errs.push('amount over ₹100 crore — check it');
  if (!validDate(issue)) errs.push('issue_date invalid (use YYYY-MM-DD or DD/MM/YYYY)');
  if (!validDate(due)) errs.push('due_date invalid');
  if (validDate(issue) && validDate(due) && due < issue) errs.push('due_date before issue_date');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('buyer_email invalid');
  if (phoneRaw && !phone) errs.push('buyer_phone invalid');
  if (!['en', 'hi', 'hinglish'].includes(language)) errs.push('buyer_language must be en, hi or hinglish');
  if (!['key', 'regular', 'new'].includes(relationship)) errs.push('relationship must be key, regular or new');
  if (errs.length) return { error: `Row ${line}: ${errs.join(', ')}` };
  return { row: { invoice_no, buyer_name, amount_paise: amount!, issue_date: issue!, due_date: due!, phone, email, language, relationship } };
}

async function insertRows(org: Org, rows: InvoiceRow[]): Promise<{ inserted: number; duplicates: number }> {
  const sql = db();
  const before = await sql`SELECT count(*)::int AS n FROM invoices WHERE org_id = ${org.id}`;
  const queries = [];
  for (const r of rows) {
    queries.push(sql`
      INSERT INTO buyers (org_id, name, phone, email, language, relationship)
      VALUES (${org.id}, ${r.buyer_name}, ${r.phone}, ${r.email}, ${r.language}, ${r.relationship})
      ON CONFLICT (org_id, name) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, buyers.phone),
        email = COALESCE(EXCLUDED.email, buyers.email)`);
  }
  for (const r of rows) {
    // Existing invoice numbers are never overwritten.
    queries.push(sql`
      INSERT INTO invoices (org_id, buyer_id, invoice_no, amount_paise, issue_date, due_date)
      SELECT ${org.id}, b.id, ${r.invoice_no}, ${r.amount_paise}, ${r.issue_date}, ${r.due_date}
      FROM buyers b WHERE b.org_id = ${org.id} AND b.name = ${r.buyer_name}
      ON CONFLICT (org_id, invoice_no) DO NOTHING`);
  }
  await sql.transaction(queries); // all or nothing
  const after = await sql`SELECT count(*)::int AS n FROM invoices WHERE org_id = ${org.id}`;
  const inserted = after[0].n - before[0].n;
  return { inserted, duplicates: rows.length - inserted };
}

export async function addInvoice(form: FormData) {
  const { org, session } = await requireOrg();
  const raw: Record<string, string> = {};
  for (const k of ['invoice_no', 'buyer_name', 'amount', 'issue_date', 'due_date', 'buyer_phone', 'buyer_email', 'buyer_language', 'relationship']) {
    raw[k] = String(form.get(k) ?? '');
  }
  const { row, error } = validateRow(raw, 1);
  if (!row) go('/invoices', undefined, error!.replace('Row 1: ', ''));
  const { inserted } = await insertRows(org, [row]);
  await audit(org.id, `user:${session.email}`, 'invoice.added', 'invoice', row.invoice_no);
  go('/invoices', inserted ? `Invoice ${row.invoice_no} added` : undefined, inserted ? undefined : `Invoice ${row.invoice_no} already exists`);
}

export async function importCsv(form: FormData) {
  const { org, session } = await requireOrg();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) go('/invoices', undefined, 'Choose a CSV file');
  if (file.size > 2_000_000) go('/invoices', undefined, 'File too large (max 2 MB)');
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true, skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });
  if (parsed.data.length === 0) go('/invoices', undefined, 'No rows found');
  if (parsed.data.length > 2000) go('/invoices', undefined, 'Max 2,000 rows per import');

  const rows: InvoiceRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, idx) => {
    const { row, error } = validateRow(raw, idx + 2);
    if (error) errors.push(error);
    else if (seen.has(row!.invoice_no)) errors.push(`Row ${idx + 2}: duplicate invoice_no ${row!.invoice_no} in file`);
    else { seen.add(row!.invoice_no); rows.push(row!); }
  });
  // Failsafe: reject the whole file if any row is bad, so you never get a half-imported ledger.
  if (errors.length) go('/invoices', undefined, `Nothing imported. Fix these and retry: ${errors.slice(0, 5).join(' | ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`);

  const { inserted, duplicates } = await insertRows(org, rows);
  await audit(org.id, `user:${session.email}`, 'invoice.imported', 'org', org.id, { inserted, duplicates });
  go('/invoices', `Imported ${inserted} invoices${duplicates ? `, skipped ${duplicates} that already existed` : ''}`);
}

const INVOICE_TRANSITIONS: Record<string, { to: string; from: string[] }> = {
  mark_paid: { to: 'paid', from: ['open', 'payment_claimed', 'paused', 'disputed'] },
  pause: { to: 'paused', from: ['open'] },
  resume: { to: 'open', from: ['paused', 'disputed', 'payment_claimed'] },
  write_off: { to: 'written_off', from: ['open', 'paused', 'disputed'] },
};

export async function invoiceAction(form: FormData) {
  const { org, session } = await requireOrg();
  const id = String(form.get('id'));
  const action = String(form.get('action'));
  const t = INVOICE_TRANSITIONS[action];
  if (!t) go('/invoices', undefined, 'Unknown action');
  const sql = db();
  const isPaid = t.to === 'paid';
  const updated = await sql`
    UPDATE invoices SET status = ${t.to},
      paid_paise = CASE WHEN ${isPaid}::boolean THEN amount_paise ELSE paid_paise END,
      paid_at = CASE WHEN ${isPaid}::boolean THEN now() ELSE paid_at END
    WHERE id = ${id} AND org_id = ${org.id} AND status = ANY(${t.from}::text[])
    RETURNING invoice_no`;
  if (!updated.length) go('/invoices', undefined, 'That change is not allowed for this invoice');
  if (t.to !== 'open') {
    await sql`UPDATE reminders SET status = 'cancelled', hold_reason = ${`Invoice ${t.to}`} WHERE invoice_id = ${id} AND status IN ('pending_approval','queued','held')`;
  }
  await audit(org.id, `user:${session.email}`, `invoice.${action}`, 'invoice', id);
  go('/invoices', `Invoice ${updated[0].invoice_no}: ${t.to.replace('_', ' ')}`);
}

// ---------- Buyers ----------

export async function updateBuyer(form: FormData) {
  const { org, session } = await requireOrg();
  const id = String(form.get('id'));
  const phoneRaw = String(form.get('phone') ?? '').trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) go('/buyers', undefined, 'Invalid phone number');
  const email = String(form.get('email') ?? '').trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) go('/buyers', undefined, 'Invalid email');
  const language = String(form.get('language'));
  const relationship = String(form.get('relationship'));
  const modeRaw = String(form.get('mode_override'));
  const mode = modeRaw === 'default' ? null : modeRaw;
  const dnc = form.get('do_not_contact') === 'on';
  const pausedUntil = String(form.get('paused_until') ?? '').trim() || null;
  if (!['en', 'hi', 'hinglish'].includes(language) || !['key', 'regular', 'new'].includes(relationship)) go('/buyers', undefined, 'Invalid value');
  if (mode && !['auto', 'approve', 'manual'].includes(mode)) go('/buyers', undefined, 'Invalid mode');
  if (pausedUntil && !validDate(pausedUntil)) go('/buyers', undefined, 'Invalid pause date');

  const sql = db();
  await sql`
    UPDATE buyers SET contact_name = ${String(form.get('contact_name') ?? '').trim() || null}, phone = ${phone}, email = ${email},
      language = ${language}, relationship = ${relationship}, mode_override = ${mode},
      do_not_contact = ${dnc}, paused_until = ${pausedUntil}
    WHERE id = ${id} AND org_id = ${org.id}`;
  if (dnc) {
    await sql`UPDATE reminders SET status = 'cancelled', hold_reason = 'Buyer set to do-not-contact' WHERE buyer_id = ${id} AND org_id = ${org.id} AND status IN ('pending_approval','queued','held')`;
  }
  await audit(org.id, `user:${session.email}`, 'buyer.updated', 'buyer', id, { mode, relationship, dnc });
  go('/buyers', 'Buyer saved');
}

// ---------- Settings ----------

export async function updateSettings(form: FormData) {
  const { org, session } = await requireOrg();
  const num = (k: string) => Number(form.get(k));
  const upi = String(form.get('upi_id') ?? '').trim() || null;
  if (upi && !/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(upi)) go('/settings', undefined, 'UPI ID looks wrong (example: sharmatraders@okhdfcbank)');
  const enterprise = String(form.get('enterprise_type'));
  if (!['micro', 'small', 'medium', 'none'].includes(enterprise)) go('/settings', undefined, 'Invalid enterprise type');
  const udyam = String(form.get('udyam_number') ?? '').trim().toUpperCase() || null;
  if (udyam && !/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(udyam)) go('/settings', undefined, 'Udyam number format: UDYAM-XX-00-0000000');
  const threshold = parseRupeesToPaise(String(form.get('approval_threshold') ?? ''));
  if (threshold === null) go('/settings', undefined, 'Invalid approval threshold');
  const qs = num('quiet_start_hour'), qe = num('quiet_end_hour');
  if (!(qs >= 0 && qs <= 23 && qe >= 1 && qe <= 24 && qe > qs)) go('/settings', undefined, 'Sending hours are invalid');
  const cap = num('daily_send_cap');
  if (!(cap >= 0 && cap <= 500)) go('/settings', undefined, 'Daily cap must be 0–500');
  const gap = num('min_gap_days');
  if (!(gap >= 1 && gap <= 30)) go('/settings', undefined, 'Gap must be 1–30 days');
  const maxR = num('max_reminders_per_invoice');
  if (!(maxR >= 1 && maxR <= 12)) go('/settings', undefined, 'Max reminders must be 1–12');

  await db()`
    UPDATE orgs SET name = ${String(form.get('name') ?? org.name).trim() || org.name},
      sender_name = ${String(form.get('sender_name') ?? org.sender_name).trim() || org.sender_name},
      upi_id = ${upi}, upi_payee_name = ${String(form.get('upi_payee_name') ?? '').trim() || null},
      udyam_number = ${udyam}, enterprise_type = ${enterprise},
      approval_threshold_paise = ${threshold}, quiet_start_hour = ${qs}, quiet_end_hour = ${qe},
      daily_send_cap = ${cap}, min_gap_days = ${gap}, max_reminders_per_invoice = ${maxR}
    WHERE id = ${org.id}`;
  await audit(org.id, `user:${session.email}`, 'settings.updated');
  go('/settings', 'Settings saved');
}
