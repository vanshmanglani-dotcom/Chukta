import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { runEngine } from '@/lib/engine/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // Failsafe: no secret configured means the cron cannot run.
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sql = db();

  // Run lock: skip if another run started in the last 15 minutes and hasn't finished.
  const running = await sql`
    SELECT id FROM cron_runs WHERE status = 'running' AND started_at > now() - interval '15 minutes' LIMIT 1`;
  if (running.length) return NextResponse.json({ skipped: 'another run in progress' });

  const [run] = await sql`INSERT INTO cron_runs DEFAULT VALUES RETURNING id`;
  try {
    const stats = await runEngine({ actor: 'system:cron' });
    await sql`UPDATE cron_runs SET status = 'ok', finished_at = now(), summary = ${JSON.stringify(stats)}::jsonb WHERE id = ${run.id}`;
    return NextResponse.json(stats);
  } catch (err) {
    await sql`UPDATE cron_runs SET status = 'error', finished_at = now(), summary = ${JSON.stringify({ error: (err as Error).message })}::jsonb WHERE id = ${run.id}`;
    return NextResponse.json({ error: 'run failed' }, { status: 500 });
  }
}
