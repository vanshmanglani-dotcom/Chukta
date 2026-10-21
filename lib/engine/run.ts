import 'server-only';
import { db, type Org, type Reminder } from '../db';
import { env, getGlobalKill } from '../config';
import { audit } from '../audit';
import { draftReminder } from '../ai';
import { sendEmail } from '../email';
import { formatINR } from '../money';
import { daysBetween, istHour, istToday, toDateStr } from '../time';
import { payPageUrl } from '../links';
import { idempotencyKey, stageFor, type Stage } from './ladder';
import { decideMode } from './mode';
import { checkDraft } from './guardrails';
import { sendGate, shouldTrip } from './safety';
import { composeMessage } from './compose';

export interface RunStats {
  orgs: number;
  considered: number;
  drafted: number;
  held: number;
  pendingApproval: number;
  queued: number;
  sent: number;
  failed: number;
  deferred: number;
  skipped: number;
  aborted: string | null;
}

export function emptyStats(): RunStats {
  return { orgs: 0, considered: 0, drafted: 0, held: 0, pendingApproval: 0, queued: 0, sent: 0, failed: 0, deferred: 0, skipped: 0, aborted: null };
}

interface Candidate {
  invoice_id: string;
  invoice_no: string;
  amount_paise: string;
  paid_paise: string;
  due_date: string | Date;
  public_token: string;
  buyer_id: string;
  buyer_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  language: 'en' | 'hi' | 'hinglish';
  relationship: 'key' | 'regular' | 'new';
  mode_override: 'auto' | 'approve' | 'manual' | null;
  reminder_count: number;
  has_open_item: boolean;
  last_sent_to_buyer: string | null;
}

export function legalMentionAllowed(org: Org): boolean {
  return Boolean(org.udyam_number) && (org.enterprise_type === 'micro' || org.enterprise_type === 'small');
}

/** Phase 1: create drafts for everything that is due. Never sends. */
export async function draftForOrg(org: Org, stats: RunStats, aiBudget: { left: number }, now = new Date()): Promise<void> {
  const sql = db();
  const today = istToday(now);

  const candidates = (await sql`
    SELECT i.id AS invoice_id, i.invoice_no, i.amount_paise, i.paid_paise, i.due_date, i.public_token,
           b.id AS buyer_id, b.name AS buyer_name, b.contact_name, b.phone, b.email, b.language,
           b.relationship, b.mode_override,
           (SELECT count(*)::int FROM reminders r WHERE r.invoice_id = i.id AND r.status NOT IN ('cancelled','skipped')) AS reminder_count,
           EXISTS (SELECT 1 FROM reminders r WHERE r.invoice_id = i.id AND r.status IN ('pending_approval','queued','held')) AS has_open_item,
           (SELECT max(r.sent_at) FROM reminders r WHERE r.buyer_id = b.id AND r.status = 'sent') AS last_sent_to_buyer
    FROM invoices i
    JOIN buyers b ON b.id = i.buyer_id
    WHERE i.org_id = ${org.id}
      AND i.status = 'open'
      AND i.paid_paise < i.amount_paise
      AND i.due_date <= (${today}::date + 3)
      AND b.do_not_contact = false
      AND b.opted_out_at IS NULL
      AND (b.paused_until IS NULL OR b.paused_until < ${today}::date)
    ORDER BY i.due_date ASC`) as Candidate[];

  const buyersTouched = new Set<string>();

  for (const c of candidates) {
    stats.considered++;
    // One new message per buyer per run; oldest invoice first.
    if (buyersTouched.has(c.buyer_id)) continue;
    if (c.has_open_item) { buyersTouched.add(c.buyer_id); continue; }
    if (c.reminder_count >= org.max_reminders_per_invoice) continue;
    if (c.last_sent_to_buyer && daysBetween(toDateStr(new Date(c.last_sent_to_buyer)), today) < org.min_gap_days) continue;

    const dueDate = toDateStr(c.due_date);
    const stage = stageFor(dueDate, today);
    if (stage === null) continue;

    const outstanding = Number(c.amount_paise) - Number(c.paid_paise);
    const decision = decideMode({
      stage,
      relationship: c.relationship,
      override: c.mode_override,
      outstandingPaise: outstanding,
      approvalThresholdPaise: Number(org.approval_threshold_paise),
      hasEmail: Boolean(c.email),
      hasPhone: Boolean(c.phone),
    });
    if (!decision.ok) { stats.skipped++; continue; }

    const key = idempotencyKey(c.invoice_id, stage, today);
    const exists = await sql`SELECT 1 FROM reminders WHERE idempotency_key = ${key}`;
    if (exists.length) continue;

    if (aiBudget.left <= 0) { stats.aborted = 'AI draft budget for this run used up'; return; }
    aiBudget.left--;
    buyersTouched.add(c.buyer_id);

    const amountFormatted = formatINR(outstanding);
    let status: Reminder['status'];
    let subject = '';
    let body = '';
    let holdReason: string | null = null;
    let model: string | null = null;

    try {
      const draft = await draftReminder({
        stage, channel: decision.channel, language: c.language,
        senderName: org.sender_name, supplierName: org.name,
        buyerName: c.buyer_name, contactName: c.contact_name,
        invoiceNo: c.invoice_no, amountFormatted, dueDate,
        daysOverdue: daysBetween(dueDate, today),
        legalMentionAllowed: legalMentionAllowed(org),
      });
      subject = draft.subject;
      body = draft.body;
      model = draft.model;
      const guard = checkDraft({
        stage, channel: decision.channel, body, subject,
        invoiceNo: c.invoice_no, amountFormatted,
        legalMentionAllowed: legalMentionAllowed(org),
      });
      if (!guard.ok) { status = 'held'; holdReason = `Safety check failed: ${guard.reasons.join('; ')}`; }
      else status = decision.mode === 'auto' ? 'queued' : 'pending_approval';
    } catch (err) {
      // AI is required: if it fails we hold the reminder. We never fall back to sending a template.
      status = 'held';
      holdReason = `AI drafting failed: ${(err as Error).message.slice(0, 300)}`;
      body = body || '(no draft — AI unavailable)';
    }

    const inserted = await sql`
      INSERT INTO reminders (org_id, invoice_id, buyer_id, stage, channel, mode, status, subject, body, ai_model, hold_reason, idempotency_key)
      VALUES (${org.id}, ${c.invoice_id}, ${c.buyer_id}, ${stage}, ${decision.channel}, ${decision.mode}, ${status},
              ${subject || null}, ${body}, ${model}, ${holdReason ?? decision.reason}, ${key})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`;
    if (!inserted.length) continue;

    stats.drafted++;
    if (status === 'held') stats.held++;
    else if (status === 'queued') stats.queued++;
    else stats.pendingApproval++;
    await audit(org.id, 'system:engine', `reminder.${status}`, 'reminder', inserted[0].id, { stage, mode: decision.mode, channel: decision.channel });
  }
}

/** Phase 2: send queued auto-emails that pass every gate. */
export async function sendQueuedForOrg(org: Org, stats: RunStats, sendBudget: { left: number }, now = new Date()): Promise<void> {
  const sql = db();
  const today = istToday(now);
  const globalKill = await getGlobalKill();

  const queued = (await sql`
    SELECT r.*, i.public_token, i.status AS invoice_status, i.invoice_no,
           b.email AS buyer_email, b.do_not_contact, b.opted_out_at, b.paused_until
    FROM reminders r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN buyers b ON b.id = r.buyer_id
    WHERE r.org_id = ${org.id} AND r.status = 'queued' AND r.mode = 'auto' AND r.channel = 'email'
    ORDER BY r.created_at ASC`) as (Reminder & {
      public_token: string; invoice_status: string; invoice_no: string; buyer_email: string | null;
      do_not_contact: boolean; opted_out_at: string | null; paused_until: string | Date | null;
    })[];

  let consecutiveFailures = 0;
  for (const r of queued) {
    // Re-read the org flag each send so flipping the kill switch mid-run takes effect immediately.
    const fresh = await sql`SELECT kill_switch FROM orgs WHERE id = ${org.id}`;
    const sentToday = await sql`
      SELECT count(*)::int AS n FROM reminders
      WHERE org_id = ${org.id} AND status = 'sent' AND sent_at >= (${today}::date::timestamp - interval '5 hours 30 minutes')`;
    const blocked = r.do_not_contact || Boolean(r.opted_out_at) ||
      (r.paused_until !== null && toDateStr(r.paused_until) >= today);

    const gate = sendGate({
      envKill: env.envKill(), globalKill, orgKill: Boolean(fresh[0]?.kill_switch),
      dryRun: env.dryRun(), hourIST: istHour(now),
      quietStart: org.quiet_start_hour, quietEnd: org.quiet_end_hour,
      sentToday: sentToday[0].n, dailyCap: org.daily_send_cap,
      buyerBlocked: blocked, invoiceOpen: r.invoice_status === 'open',
    });
    if (!gate.allow) {
      if (gate.retryLater) { stats.deferred++; await sql`UPDATE reminders SET hold_reason = ${gate.reason} WHERE id = ${r.id}`; }
      else { stats.skipped++; await sql`UPDATE reminders SET status = 'cancelled', hold_reason = ${gate.reason} WHERE id = ${r.id}`; }
      continue;
    }
    if (!r.buyer_email) {
      await sql`UPDATE reminders SET status = 'pending_approval', hold_reason = 'No email on file' WHERE id = ${r.id}`;
      continue;
    }
    if (!env.emailConfigured()) {
      // No provider yet: hand it to the owner instead of silently dropping it.
      await sql`UPDATE reminders SET status = 'pending_approval', mode = 'approve', hold_reason = 'Email sending not set up — review and send yourself' WHERE id = ${r.id}`;
      stats.pendingApproval++;
      continue;
    }
    if (sendBudget.left <= 0) { stats.aborted = 'Send budget for this run used up'; return; }
    sendBudget.left--;

    // Claim the row first so two overlapping runs can't double-send.
    const claimed = await sql`UPDATE reminders SET status = 'sent', sent_at = now() WHERE id = ${r.id} AND status = 'queued' RETURNING id`;
    if (!claimed.length) continue;

    const result = await sendEmail({
      to: r.buyer_email,
      subject: r.subject || `Payment reminder: invoice ${r.invoice_no}`,
      text: composeMessage(r.body, payPageUrl(r.public_token), 'email'),
    });
    if (result.ok) {
      consecutiveFailures = 0;
      stats.sent++;
      await audit(org.id, 'system:engine', 'reminder.sent', 'reminder', r.id, { providerId: result.providerId });
    } else {
      consecutiveFailures++;
      stats.failed++;
      await sql`UPDATE reminders SET status = ${result.retryable ? 'queued' : 'failed'}, sent_at = NULL, error = ${result.error} WHERE id = ${r.id}`;
      await audit(org.id, 'system:engine', 'reminder.failed', 'reminder', r.id, { error: result.error });
      if (shouldTrip(consecutiveFailures)) {
        stats.aborted = `Circuit breaker: ${consecutiveFailures} failures in a row (${result.error})`;
        await audit(org.id, 'system:engine', 'circuit_breaker.tripped', 'org', org.id, { error: result.error });
        return;
      }
    }
  }
}

/** Full run across orgs (cron) or one org ("Run now"). */
export async function runEngine(opts: { orgId?: string; actor: string; now?: Date }): Promise<RunStats> {
  const stats = emptyStats();
  const now = opts.now ?? new Date();
  if (env.envKill()) { stats.aborted = 'Platform kill switch (env) is ON'; return stats; }
  if (await getGlobalKill()) { stats.aborted = 'Platform kill switch is ON'; return stats; }

  const sql = db();
  const orgs = (opts.orgId
    ? await sql`SELECT * FROM orgs WHERE id = ${opts.orgId}`
    : await sql`SELECT * FROM orgs`) as Org[];

  const aiBudget = { left: env.maxAiDraftsPerRun() };
  const sendBudget = { left: env.maxSendsPerRun() };

  for (const org of orgs) {
    if (org.kill_switch) continue;
    stats.orgs++;
    try {
      await draftForOrg(org, stats, aiBudget, now);
      await sendQueuedForOrg(org, stats, sendBudget, now);
    } catch (err) {
      // One org's failure must not stop the others.
      console.error('engine org failure', org.id, err);
      await audit(org.id, opts.actor, 'engine.error', 'org', org.id, { error: (err as Error).message });
    }
    if (stats.aborted?.startsWith('AI draft budget') || stats.aborted?.startsWith('Send budget')) break;
  }
  return stats;
}

export type { Stage };
