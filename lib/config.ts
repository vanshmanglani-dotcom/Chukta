import { db } from './db';

export const env = {
  appUrl: () => (process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, ''),
  envKill: () => process.env.KILL_SWITCH === '1',
  dryRun: () => process.env.DRY_RUN === '1',
  aiModel: () => process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5',
  aiConfigured: () => Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL),
  emailConfigured: () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  maxAiDraftsPerRun: () => Number(process.env.MAX_AI_DRAFTS_PER_RUN || 100),
  maxSendsPerRun: () => Number(process.env.MAX_SENDS_PER_RUN || 200),
};

export async function getGlobalKill(): Promise<boolean> {
  const rows = await db()`SELECT value FROM app_config WHERE key = 'global_kill_switch'`;
  // Failsafe: if the flag row is missing, treat the platform as killed rather than live.
  return rows.length === 0 || rows[0].value !== 'off';
}

export async function setGlobalKill(on: boolean, by: string): Promise<void> {
  await db()`
    INSERT INTO app_config (key, value, updated_by, updated_at)
    VALUES ('global_kill_switch', ${on ? 'on' : 'off'}, ${by}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}
