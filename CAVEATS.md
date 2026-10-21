# Caveats — read before real customers use this

This is an MVP for validating demand with a handful of friendly businesses. It is not production-hardened.

## Legal and compliance
- **Not legal advice.** The 45-day rule (MSMED Act §15) and the tax disallowance (Income-tax Act 2025 §37(2)(g), formerly §43B(h)) only protect Udyam-registered **micro and small** suppliers, and only when the buyer is a business claiming the expense. Have a lawyer review the escalation wording before you let anyone use stages 3–4.
- **DPDP Act 2023.** You are storing buyers' names, phone numbers and emails on behalf of suppliers. Before launch you need a privacy notice, a data processing agreement with suppliers, and deletion on request. The opt-out link helps but is not full compliance.
- **Email rules.** Auto-email needs a verified sending domain (SPF, DKIM, DMARC) in Resend. Sending from a fresh domain to many buyers can land in spam.
- **WhatsApp.** The MVP does **not** use the WhatsApp Business API. The owner taps a button that opens WhatsApp with the message filled in, and Chukta records it as sent — it cannot confirm delivery. Automating WhatsApp later needs Meta Business verification, approved templates and per-message fees.
- **Telecom.** No SMS or voice calls are sent, so TRAI DLT rules don't apply yet. They will if you add either.

## Product
- Payments are not verified. "Paid" is either the owner's click or the buyer's claim, which the owner confirms. There is no UPI/bank reconciliation yet.
- UPI links use the supplier's own UPI ID. Chukta never touches money, so there is no payment-aggregator licence issue — but also no proof of payment.
- The daily cron runs once a day on Vercel's Hobby plan (timing can drift within the hour). Use "Run now" for an immediate run.
- Tally/Vyapar/Zoho integration is not built — CSV import only.
- Partial payments are tracked in the schema (`paid_paise`) but there is no UI to record them yet.
- One user per business. No team roles.

## Security
- Passwords are bcrypt-hashed; sessions are signed HTTP-only cookies. There is no login rate limiting, 2FA, or password reset yet.
- Buyer payment pages are protected only by an unguessable 128-bit token in the link. Anyone with the link can see the invoice amount and stop reminders (they cannot start them or see other invoices).
- Neon is reached over the public internet with TLS. Rotate the database password if it is ever shared.

## AI
- Drafts are checked by rules, not by a human, before auto-sending. The rules catch threats, wrong amounts and invented links, but tone can still be off. Start with every buyer on "Always ask me" for the first week and read what it writes.
- AI Gateway usage costs money per draft. `MAX_AI_DRAFTS_PER_RUN` caps it per run.
- If AI is down, reminders are held, so nothing goes out that day. This is deliberate.

## Business risk worth testing early
- Suppliers may fear upsetting large buyers. Watch how many owners switch key accounts to "Always ask me" or "Never contact" — that tells you whether the tone works.
