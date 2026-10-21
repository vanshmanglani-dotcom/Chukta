-- Chukta MVP schema. Money is stored in paise (bigint) to avoid float errors.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
-- Global runtime kill switch (flip without redeploying).
INSERT INTO app_config (key, value) VALUES ('global_kill_switch', 'off')
  ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS orgs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  sender_name             text NOT NULL,
  upi_id                  text,
  upi_payee_name          text,
  udyam_number            text,
  enterprise_type         text CHECK (enterprise_type IN ('micro','small','medium','none')) DEFAULT 'none',
  kill_switch             boolean NOT NULL DEFAULT false,
  daily_send_cap          int NOT NULL DEFAULT 25 CHECK (daily_send_cap BETWEEN 0 AND 500),
  approval_threshold_paise bigint NOT NULL DEFAULT 10000000, -- Rs 1,00,000
  quiet_start_hour        int NOT NULL DEFAULT 10 CHECK (quiet_start_hour BETWEEN 0 AND 23),
  quiet_end_hour          int NOT NULL DEFAULT 19 CHECK (quiet_end_hour BETWEEN 1 AND 24),
  min_gap_days            int NOT NULL DEFAULT 3 CHECK (min_gap_days >= 1),
  max_reminders_per_invoice int NOT NULL DEFAULT 6 CHECK (max_reminders_per_invoice BETWEEN 1 AND 12),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buyers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name            text NOT NULL,
  contact_name    text,
  phone           text,
  email           text,
  language        text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','hinglish')),
  relationship    text NOT NULL DEFAULT 'regular' CHECK (relationship IN ('key','regular','new')),
  mode_override   text CHECK (mode_override IN ('auto','approve','manual')),
  do_not_contact  boolean NOT NULL DEFAULT false,
  opted_out_at    timestamptz,
  paused_until    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  buyer_id           uuid NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  invoice_no         text NOT NULL,
  amount_paise       bigint NOT NULL CHECK (amount_paise > 0),
  paid_paise         bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  issue_date         date NOT NULL,
  due_date           date NOT NULL,
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','payment_claimed','paid','disputed','paused','written_off')),
  public_token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  dispute_reason     text,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_no),
  CHECK (due_date >= issue_date)
);
CREATE INDEX IF NOT EXISTS invoices_org_status_idx ON invoices (org_id, status, due_date);

CREATE TABLE IF NOT EXISTS reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  buyer_id         uuid NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  stage            int NOT NULL CHECK (stage BETWEEN 0 AND 4),
  channel          text NOT NULL CHECK (channel IN ('email','whatsapp')),
  mode             text NOT NULL CHECK (mode IN ('auto','approve','manual')),
  status           text NOT NULL
                   CHECK (status IN ('pending_approval','queued','sent','failed','skipped','cancelled','held')),
  subject          text,
  body             text NOT NULL,
  ai_model         text,
  hold_reason      text,
  idempotency_key  text NOT NULL UNIQUE,  -- one reminder per invoice per stage per day
  sent_at          timestamptz,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_org_status_idx ON reminders (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reminders_buyer_idx ON reminders (buyer_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES orgs(id) ON DELETE CASCADE,
  actor       text NOT NULL,           -- 'user:<email>', 'system:cron', 'buyer:<token>'
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_log (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cron_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running',
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb
);
