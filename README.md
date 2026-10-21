# Chukta — AI payment reminders for Indian small businesses

Upload unpaid invoices → Chukta drafts reminders with AI (English, Hindi, Hinglish) → routine ones go out automatically, sensitive ones wait for the owner → buyers pay by UPI from a one-page link, or tell you they've paid / disputed / want to opt out (all of which stop reminders instantly).

**Stack:** Next.js 15 (App Router) · Neon Postgres · Vercel (hosting, cron, AI Gateway) · Resend (optional email)

## How it works

| Piece | Where |
|---|---|
| Escalation ladder (heads-up → gentle → firm → escalation → final notice) | `lib/engine/ladder.ts` |
| Hybrid sending decided by buyer profile | `lib/engine/mode.ts` |
| AI drafting (required; failures are held, never replaced by templates) | `lib/ai.ts` |
| Safety checks on every AI draft | `lib/engine/guardrails.ts` |
| Send gate (kill switches, hours, caps, dry run) | `lib/engine/safety.ts` |
| Orchestrator (draft phase, then send phase) | `lib/engine/run.ts` |
| Daily cron, 10:00 IST | `app/api/cron/run` + `vercel.json` |
| Buyer payment page | `app/p/[token]` |

### Hybrid sending rules

| Buyer profile | What happens |
|---|---|
| Regular buyer with email, normal amount, stages 0–2 | **Auto** email (within sending hours and daily cap) |
| Regular buyer, no email | Owner sends on WhatsApp in one tap |
| Key account or new buyer | Owner approves every message |
| Any buyer, stage 3–4 (22+ days overdue) | **Always** owner approval — cannot be overridden |
| Any buyer, amount ≥ approval threshold (default ₹1,00,000) | **Always** owner approval — cannot be overridden |

## Failsafes and kill switches

**Kill switches, from broadest to narrowest**
1. `KILL_SWITCH=1` env var → nothing drafts or sends on the whole platform (takes effect on redeploy).
2. Global DB flag → same, but instant, no redeploy:
   `curl -X POST https://<app>/api/admin/kill -H "Authorization: Bearer $ADMIN_SECRET" -d '{"on":true}'`
   If the flag row is ever missing, the platform treats itself as **killed** (fail closed).
3. Per-business switch on the dashboard → stops drafting and sending for that business; checked again before every single send, so flipping it mid-run works.
4. Per-buyer: do-not-contact, pause until a date, or buyer opt-out from the payment page.
5. Per-invoice: pause, mark paid, write off, or a buyer's "already paid" / "dispute" click.

**Other failsafes**
- `DRY_RUN=1` drafts everything and sends nothing.
- AI is required, and every draft passes a safety check: the invoice number and amount must be exact; no threats (police, jail, family, social media, credit score…); no links invented by AI; no placeholders; legal references only for Udyam micro/small businesses at escalation stage, and those always need approval. Failing drafts are **held**, not sent.
- Owner edits go through the same safety check.
- Idempotency key per invoice per stage (stage 4 max once a week) → no duplicate reminders, even if cron fires twice.
- Rows are claimed atomically before sending → overlapping runs cannot double-send.
- Cron run lock (15 min) and `CRON_SECRET` bearer auth (no secret = cron refuses to run).
- Sending hours (default 10:00–19:00 IST), daily cap per business, minimum gap between messages to the same buyer, and a max number of reminders per invoice.
- Per-run budgets: `MAX_AI_DRAFTS_PER_RUN` (AI cost ceiling) and `MAX_SENDS_PER_RUN`.
- Circuit breaker: 5 send failures in a row aborts the run.
- One business failing never stops the others.
- CSV import is all-or-nothing, and never overwrites an existing invoice number.
- Everything is written to `audit_log`.

## Local development

```bash
cp .env.example .env.local   # fill DATABASE_URL, SESSION_SECRET, AI_GATEWAY_API_KEY
npm install
npm run db:migrate
npm run dev
npm test
```

## Deploy

Push to `main` → Vercel builds production. Pull requests get preview deployments, and CI runs type-check, tests and build.

Required Vercel env vars: `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_SECRET`. AI uses Vercel AI Gateway (OIDC auth on Vercel, no key needed). See `CAVEATS.md` before using this with real customers.
