/**
 * Pure send-gate. Every outbound message must pass ALL of these, checked right before sending.
 * Kill switches are layered: env (deploy-level) > global DB flag > org flag > buyer > invoice.
 */
export interface GateInput {
  envKill: boolean;
  globalKill: boolean;
  orgKill: boolean;
  dryRun: boolean;
  hourIST: number;
  quietStart: number; // first allowed hour, inclusive
  quietEnd: number; // last allowed hour, exclusive
  sentToday: number;
  dailyCap: number;
  buyerBlocked: boolean; // do-not-contact, opted out, or paused
  invoiceOpen: boolean;
}

export type GateResult = { allow: true } | { allow: false; reason: string; retryLater: boolean };

export function sendGate(g: GateInput): GateResult {
  if (g.envKill) return { allow: false, reason: 'Platform kill switch (env) is ON', retryLater: true };
  if (g.globalKill) return { allow: false, reason: 'Platform kill switch is ON', retryLater: true };
  if (g.orgKill) return { allow: false, reason: 'Your kill switch is ON', retryLater: true };
  if (!g.invoiceOpen) return { allow: false, reason: 'Invoice is no longer open', retryLater: false };
  if (g.buyerBlocked) return { allow: false, reason: 'Buyer is paused or opted out', retryLater: false };
  if (g.hourIST < g.quietStart || g.hourIST >= g.quietEnd) {
    return { allow: false, reason: `Outside sending hours (${g.quietStart}:00–${g.quietEnd}:00 IST)`, retryLater: true };
  }
  if (g.sentToday >= g.dailyCap) return { allow: false, reason: `Daily cap of ${g.dailyCap} reached`, retryLater: true };
  if (g.dryRun) return { allow: false, reason: 'Dry-run mode: nothing is sent', retryLater: true };
  return { allow: true };
}

/** Circuit breaker: stop a run when sends keep failing (bad provider, bad config). */
export function shouldTrip(consecutiveFailures: number, threshold = 5): boolean {
  return consecutiveFailures >= threshold;
}
