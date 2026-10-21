import type { Stage } from './ladder';

export type Mode = 'auto' | 'approve' | 'manual';
export type Channel = 'email' | 'whatsapp';
export type Relationship = 'key' | 'regular' | 'new';

export interface ModeInput {
  stage: Stage;
  relationship: Relationship;
  override: Mode | null;
  outstandingPaise: number;
  approvalThresholdPaise: number;
  hasEmail: boolean;
  hasPhone: boolean;
}

export type ModeDecision =
  | { ok: true; mode: Mode; channel: Channel; reason: string }
  | { ok: false; reason: string };

/**
 * Hybrid sending, decided per buyer profile.
 * Hard rules (cannot be overridden by the buyer's profile setting):
 *  - Escalations (stage 3+) always need owner approval.
 *  - Amounts at/above the approval threshold never go out automatically.
 *  - Auto-send only exists for email; WhatsApp is always sent by the owner (no Business API yet).
 */
export function decideMode(i: ModeInput): ModeDecision {
  if (!i.hasEmail && !i.hasPhone) return { ok: false, reason: 'Buyer has no phone or email' };

  let mode: Mode;
  let reason: string;

  if (i.override) {
    mode = i.override;
    reason = `Buyer setting: ${i.override}`;
  } else if (i.relationship === 'key') {
    mode = 'approve';
    reason = 'Key account — you review every message';
  } else if (i.relationship === 'new') {
    mode = 'approve';
    reason = 'New buyer — you review until the relationship is established';
  } else {
    mode = 'auto';
    reason = 'Regular buyer — routine reminder';
  }

  // Hard failsafes run after the profile so the profile can never weaken them.
  if (mode === 'auto' && i.stage >= 3) {
    mode = 'approve';
    reason = 'Escalation stage — always reviewed by you';
  }
  if (mode === 'auto' && i.outstandingPaise >= i.approvalThresholdPaise) {
    mode = 'approve';
    reason = 'Large amount — always reviewed by you';
  }

  let channel: Channel;
  if (mode === 'auto') {
    if (i.hasEmail) channel = 'email';
    else {
      mode = 'manual';
      channel = 'whatsapp';
      reason = 'No email on file — you send it on WhatsApp';
    }
  } else {
    channel = i.hasPhone ? 'whatsapp' : 'email';
  }

  return { ok: true, mode, channel, reason };
}
