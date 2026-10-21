import { describe, expect, it } from 'vitest';
import { idempotencyKey, stageFor } from '@/lib/engine/ladder';
import { decideMode } from '@/lib/engine/mode';
import { checkDraft } from '@/lib/engine/guardrails';
import { sendGate, shouldTrip } from '@/lib/engine/safety';
import { formatINR, parseRupeesToPaise } from '@/lib/money';
import { daysBetween, istHour, istToday } from '@/lib/time';
import { normalizePhone } from '@/lib/links';

describe('ladder', () => {
  it('maps days overdue to stages', () => {
    expect(stageFor('2026-10-30', '2026-10-22')).toBeNull();
    expect(stageFor('2026-10-25', '2026-10-22')).toBe(0);
    expect(stageFor('2026-10-22', '2026-10-22')).toBe(0);
    expect(stageFor('2026-10-21', '2026-10-22')).toBe(1);
    expect(stageFor('2026-10-10', '2026-10-22')).toBe(2);
    expect(stageFor('2026-09-20', '2026-10-22')).toBe(3);
    expect(stageFor('2026-08-01', '2026-10-22')).toBe(4);
  });
  it('allows stage 4 once a week, others once ever', () => {
    expect(idempotencyKey('x', 2, '2026-10-22')).toBe('x:2');
    expect(idempotencyKey('x', 4, '2026-10-22')).toBe(idempotencyKey('x', 4, '2026-10-23'));
    expect(idempotencyKey('x', 4, '2026-10-22')).not.toBe(idempotencyKey('x', 4, '2026-10-30'));
  });
});

describe('hybrid mode', () => {
  const base = { stage: 1 as const, relationship: 'regular' as const, override: null, outstandingPaise: 50_000_00, approvalThresholdPaise: 1_00_000_00, hasEmail: true, hasPhone: true };
  it('auto-emails routine reminders to regular buyers', () => {
    expect(decideMode(base)).toMatchObject({ ok: true, mode: 'auto', channel: 'email' });
  });
  it('key and new buyers need approval', () => {
    expect(decideMode({ ...base, relationship: 'key' })).toMatchObject({ mode: 'approve', channel: 'whatsapp' });
    expect(decideMode({ ...base, relationship: 'new' })).toMatchObject({ mode: 'approve' });
  });
  it('escalations can never auto-send, even with an auto override', () => {
    expect(decideMode({ ...base, stage: 3, override: 'auto' })).toMatchObject({ mode: 'approve' });
    expect(decideMode({ ...base, stage: 4, override: 'auto' })).toMatchObject({ mode: 'approve' });
  });
  it('large amounts can never auto-send', () => {
    expect(decideMode({ ...base, override: 'auto', outstandingPaise: 2_00_000_00 })).toMatchObject({ mode: 'approve' });
  });
  it('falls back to owner-sent WhatsApp with no email', () => {
    expect(decideMode({ ...base, hasEmail: false })).toMatchObject({ mode: 'manual', channel: 'whatsapp' });
  });
  it('skips buyers with no contact details', () => {
    expect(decideMode({ ...base, hasEmail: false, hasPhone: false }).ok).toBe(false);
  });
});

describe('guardrails', () => {
  const ok = { stage: 1 as const, channel: 'whatsapp' as const, invoiceNo: 'INV-1', amountFormatted: '₹48,500', legalMentionAllowed: false,
    body: 'Hi Gupta ji, a gentle reminder that invoice INV-1 for ₹48,500 is now due. Please let us know the payment date. — Ramesh' };
  it('passes a clean draft', () => expect(checkDraft(ok)).toEqual({ ok: true }));
  it('blocks threats', () => expect(checkDraft({ ...ok, body: ok.body + ' Otherwise we will go to the police.' }).ok).toBe(false));
  it('blocks altered amounts', () => expect(checkDraft({ ...ok, body: ok.body.replace('48,500', '84,500') }).ok).toBe(false));
  it('blocks links the AI invents', () => expect(checkDraft({ ...ok, body: ok.body + ' Pay at https://evil.example' }).ok).toBe(false));
  it('blocks legal references unless allowed at stage 3+', () => {
    const legal = { ...ok, body: ok.body + ' Note Section 43B(h) applies.' };
    expect(checkDraft(legal).ok).toBe(false);
    expect(checkDraft({ ...legal, stage: 3, legalMentionAllowed: true }).ok).toBe(true);
  });
  it('blocks placeholders', () => expect(checkDraft({ ...ok, body: ok.body + ' [Your Name]' }).ok).toBe(false));
});

describe('send gate', () => {
  const g = { envKill: false, globalKill: false, orgKill: false, dryRun: false, hourIST: 12, quietStart: 10, quietEnd: 19, sentToday: 0, dailyCap: 25, buyerBlocked: false, invoiceOpen: true };
  it('allows a normal send', () => expect(sendGate(g).allow).toBe(true));
  it('every kill switch blocks', () => {
    expect(sendGate({ ...g, envKill: true }).allow).toBe(false);
    expect(sendGate({ ...g, globalKill: true }).allow).toBe(false);
    expect(sendGate({ ...g, orgKill: true }).allow).toBe(false);
  });
  it('respects quiet hours, caps and dry run', () => {
    expect(sendGate({ ...g, hourIST: 21 }).allow).toBe(false);
    expect(sendGate({ ...g, hourIST: 9 }).allow).toBe(false);
    expect(sendGate({ ...g, sentToday: 25 }).allow).toBe(false);
    expect(sendGate({ ...g, dryRun: true }).allow).toBe(false);
  });
  it('closed invoices and blocked buyers are cancelled, not retried', () => {
    expect(sendGate({ ...g, invoiceOpen: false })).toMatchObject({ allow: false, retryLater: false });
    expect(sendGate({ ...g, buyerBlocked: true })).toMatchObject({ allow: false, retryLater: false });
  });
  it('circuit breaker trips after 5 failures', () => {
    expect(shouldTrip(4)).toBe(false);
    expect(shouldTrip(5)).toBe(true);
  });
});

describe('money, time, phone', () => {
  it('formats and parses INR', () => {
    expect(formatINR(12500000)).toBe('₹1,25,000');
    expect(formatINR(4850050)).toBe('₹48,500.5'.replace('.5', '.50'));
    expect(parseRupeesToPaise('1,25,000')).toBe(12500000);
    expect(parseRupeesToPaise('₹ 99.5')).toBe(9950);
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('0')).toBeNull();
  });
  it('uses IST', () => {
    const t = new Date('2026-10-21T20:00:00Z'); // 01:30 IST on the 22nd
    expect(istToday(t)).toBe('2026-10-22');
    expect(istHour(t)).toBe(1);
    expect(daysBetween('2026-10-01', '2026-10-22')).toBe(21);
  });
  it('normalises Indian phones', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210');
    expect(normalizePhone('+91-98765-43210')).toBe('919876543210');
    expect(normalizePhone('09876543210')).toBe('919876543210');
    expect(normalizePhone('123')).toBeNull();
  });
});
