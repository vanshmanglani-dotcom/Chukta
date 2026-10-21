import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getGlobalKill, setGlobalKill } from '@/lib/config';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Platform-wide kill switch, no redeploy needed.
 *   curl -X POST https://<app>/api/admin/kill -H "Authorization: Bearer $ADMIN_SECRET" -d '{"on":true}'
 */
function authorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ globalKill: await getGlobalKill() });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'send {"on": true|false}' }, { status: 400 });
  await setGlobalKill(body.on, 'admin:api');
  await audit(null, 'admin:api', body.on ? 'global_kill.on' : 'global_kill.off');
  return NextResponse.json({ globalKill: body.on });
}
