import type { Stage } from './ladder';

/**
 * Validates AI-drafted messages before anything can be sent.
 * A draft that fails is HELD (never sent, never silently replaced with a template).
 */
export interface GuardInput {
  stage: Stage;
  channel: 'email' | 'whatsapp';
  body: string;
  subject?: string;
  invoiceNo: string;
  amountFormatted: string; // e.g. "₹1,25,000"
  legalMentionAllowed: boolean; // supplier is a Udyam-registered micro/small enterprise
}

export type GuardResult = { ok: true } | { ok: false; reasons: string[] };

// Coercive or defamatory language that must never appear in a collection message.
const BANNED = [
  'police', 'fir ', 'arrest', 'jail', 'prison', 'criminal', 'defam', 'blacklist',
  'harass', 'your family', 'social media', 'publicly', 'recovery agent', 'goons',
  'consequences will', 'last warning', 'we will visit', 'cibil', 'credit score',
  'पुलिस', 'गिरफ्तार', 'जेल',
];

const LEGAL_TERMS = ['43b', '37(2)(g)', 'msmed act', 'samadhaan', 'section 15', 'section 16'];

export const LIMITS = { whatsapp: 900, email: 2500, subject: 120 } as const;

export function checkDraft(i: GuardInput): GuardResult {
  const reasons: string[] = [];
  const text = `${i.subject ?? ''}\n${i.body}`;
  const lower = text.toLowerCase();

  if (!i.body.trim()) reasons.push('Empty message');
  if (i.body.length > LIMITS[i.channel]) reasons.push(`Too long for ${i.channel} (${i.body.length} chars)`);
  if (i.subject && i.subject.length > LIMITS.subject) reasons.push('Subject too long');
  if (i.channel === 'email' && !i.subject?.trim()) reasons.push('Email has no subject');

  if (!text.includes(i.invoiceNo)) reasons.push('Invoice number missing or altered');
  const amountDigits = i.amountFormatted.replace(/[^\d.]/g, '');
  const textDigits = text.replace(/,/g, '');
  if (!text.includes(i.amountFormatted) && !textDigits.includes(amountDigits)) {
    reasons.push('Amount missing or altered');
  }

  for (const w of BANNED) if (lower.includes(w)) reasons.push(`Banned phrase: "${w.trim()}"`);

  const legalHit = LEGAL_TERMS.filter((t) => lower.includes(t));
  if (legalHit.length && (!i.legalMentionAllowed || i.stage < 3)) {
    reasons.push(`Legal reference not allowed here: ${legalHit.join(', ')}`);
  }

  // We append the official payment link ourselves; AI must never invent links.
  if (/https?:\/\/|www\.|upi:\/\//i.test(text)) reasons.push('Draft contains a link');
  if (/\[[^\]]*\]|\{\{|<[a-z]+>|TODO|lorem/i.test(text)) reasons.push('Draft contains a placeholder');

  return reasons.length ? { ok: false, reasons } : { ok: true };
}
