import { daysBetween, isoWeekKey } from '../time';

/**
 * Escalation ladder. Tone gets firmer as an invoice ages.
 *  0  friendly heads-up      (due in 0–3 days)
 *  1  gentle reminder        (1–7 days overdue)
 *  2  firm follow-up         (8–21 days overdue)
 *  3  escalation             (22–44 days overdue)  — always needs owner approval
 *  4  final notice           (45+ days overdue)    — always needs owner approval, max once a week
 */
export type Stage = 0 | 1 | 2 | 3 | 4;

export const STAGE_LABELS: Record<Stage, string> = {
  0: 'Friendly heads-up',
  1: 'Gentle reminder',
  2: 'Firm follow-up',
  3: 'Escalation',
  4: 'Final notice',
};

export function stageFor(dueDate: string, today: string): Stage | null {
  const overdue = daysBetween(dueDate, today);
  if (overdue < -3) return null; // too early
  if (overdue <= 0) return 0;
  if (overdue <= 7) return 1;
  if (overdue <= 21) return 2;
  if (overdue <= 44) return 3;
  return 4;
}

/** One reminder per invoice per stage; stage 4 may repeat once per ISO week. */
export function idempotencyKey(invoiceId: string, stage: Stage, today: string): string {
  return stage === 4 ? `${invoiceId}:4:${isoWeekKey(today)}` : `${invoiceId}:${stage}`;
}
