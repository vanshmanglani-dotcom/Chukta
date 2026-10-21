import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

/** Lazily created so builds don't need DATABASE_URL. */
export function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    client = neon(url);
  }
  return client;
}

// Row types (only the columns the app uses).
export interface Org {
  id: string;
  name: string;
  sender_name: string;
  upi_id: string | null;
  upi_payee_name: string | null;
  udyam_number: string | null;
  enterprise_type: 'micro' | 'small' | 'medium' | 'none';
  kill_switch: boolean;
  daily_send_cap: number;
  approval_threshold_paise: string;
  quiet_start_hour: number;
  quiet_end_hour: number;
  min_gap_days: number;
  max_reminders_per_invoice: number;
}

export interface Buyer {
  id: string;
  org_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  language: 'en' | 'hi' | 'hinglish';
  relationship: 'key' | 'regular' | 'new';
  mode_override: 'auto' | 'approve' | 'manual' | null;
  do_not_contact: boolean;
  opted_out_at: string | null;
  paused_until: string | Date | null;
}

export interface Invoice {
  id: string;
  org_id: string;
  buyer_id: string;
  invoice_no: string;
  amount_paise: string;
  paid_paise: string;
  issue_date: string | Date;
  due_date: string | Date;
  status: 'open' | 'payment_claimed' | 'paid' | 'disputed' | 'paused' | 'written_off';
  public_token: string;
  dispute_reason: string | null;
}

export interface Reminder {
  id: string;
  org_id: string;
  invoice_id: string;
  buyer_id: string;
  stage: number;
  channel: 'email' | 'whatsapp';
  mode: 'auto' | 'approve' | 'manual';
  status: 'pending_approval' | 'queued' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'held';
  subject: string | null;
  body: string;
  hold_reason: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}
