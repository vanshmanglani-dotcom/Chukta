import 'server-only';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from './config';
import { STAGE_LABELS, type Stage } from './engine/ladder';

export interface DraftInput {
  stage: Stage;
  channel: 'email' | 'whatsapp';
  language: 'en' | 'hi' | 'hinglish';
  senderName: string;
  supplierName: string;
  buyerName: string;
  contactName: string | null;
  invoiceNo: string;
  amountFormatted: string;
  dueDate: string;
  daysOverdue: number;
  legalMentionAllowed: boolean;
}

const schema = z.object({
  subject: z.string().describe('Email subject line. For WhatsApp, a short internal title.'),
  body: z.string().describe('The message text only. No links, no sign-off placeholders.'),
});

const LANG: Record<DraftInput['language'], string> = {
  en: 'Indian business English',
  hi: 'Hindi in Devanagari script (keep the invoice number and amount exactly as given)',
  hinglish: 'Hinglish: conversational Hindi written in Roman script, as Indian business owners text on WhatsApp',
};

const TONE: Record<Stage, string> = {
  0: 'A warm, friendly heads-up that the invoice falls due soon. No pressure at all.',
  1: 'A polite, gentle reminder. Assume it slipped their mind. Offer help if anything is unclear.',
  2: 'Courteous but clearly firm. Ask for a payment date. Mention the number of days overdue.',
  3: 'Serious and professional. Request payment or a confirmed date within 7 days. Still respectful.',
  4: 'Formal final notice. Request payment within 7 days and state that the supplier may use the formal MSME dispute-resolution process if needed. Respectful, factual, no threats.',
};

export async function draftReminder(i: DraftInput): Promise<{ subject: string; body: string; model: string }> {
  const legal = i.legalMentionAllowed && i.stage >= 3
    ? `The supplier is a Udyam-registered micro/small enterprise. You MAY factually note that under the MSMED Act, buyers should pay within 45 days, and that under Section 43B(h) / Section 37(2)(g) of the Income-tax Act, delayed payments to micro and small enterprises may not be deductible for the buyer. ${i.stage === 4 ? 'You may mention that the supplier can approach MSME Samadhaan.' : 'Do not mention MSME Samadhaan.'}`
    : 'Do NOT mention any law, section, act, tax rule, tribunal or legal process.';

  const prompt = `Write a payment reminder from an Indian small business to its customer.

Supplier business: ${i.supplierName}
Sign off as: ${i.senderName}
Customer: ${i.buyerName}${i.contactName ? ` (contact: ${i.contactName})` : ''}
Invoice number: ${i.invoiceNo}
Amount outstanding: ${i.amountFormatted}
Due date: ${i.dueDate} (${i.daysOverdue > 0 ? `${i.daysOverdue} days overdue` : i.daysOverdue === 0 ? 'due today' : `due in ${-i.daysOverdue} days`})
Stage: ${STAGE_LABELS[i.stage]}
Channel: ${i.channel === 'whatsapp' ? 'WhatsApp (short, 3–6 lines, no formal letter format)' : 'Email (short business email, 4–8 lines)'}
Language: ${LANG[i.language]}

Tone: ${TONE[i.stage]}
${legal}

Strict rules:
- Include the invoice number "${i.invoiceNo}" and the amount "${i.amountFormatted}" exactly as written.
- Do not include any links, URLs, UPI IDs, bank details or phone numbers (a payment link is added automatically after your text).
- Never threaten, shame, or mention police, courts, credit scores, family, social media, or visits.
- No placeholders like [Name]. No emojis except at most one in WhatsApp stage 0–1.
- The goal is to get paid AND keep the business relationship.`;

  const model = env.aiModel();
  const { object } = await generateObject({
    model,
    schema,
    prompt,
    temperature: 0.4,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(30_000),
  });
  return { subject: object.subject.trim(), body: object.body.trim(), model };
}
