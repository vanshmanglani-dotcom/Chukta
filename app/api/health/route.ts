import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env, getGlobalKill } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  let database = 'ok';
  let globalKill: boolean | null = null;
  try {
    await db()`SELECT 1`;
    globalKill = await getGlobalKill();
  } catch {
    database = 'error';
  }
  const healthy = database === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      killSwitch: { env: env.envKill(), global: globalKill },
      dryRun: env.dryRun(),
      ai: env.aiConfigured() ? 'configured' : 'missing',
      email: env.emailConfigured() ? 'configured' : 'not set up (owner sends manually)',
    },
    { status: healthy ? 200 : 503 },
  );
}
