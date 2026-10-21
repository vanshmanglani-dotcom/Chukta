import Link from 'next/link';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { formatINR } from '@/lib/money';
import { istToday } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { runNow, toggleKill } from '../actions';

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { msg, err } = await searchParams;
  const { org } = await requireOrg();
  const sql = db();
  const today = istToday();

  const [totals] = await sql`
    SELECT
      COALESCE(sum(amount_paise - paid_paise) FILTER (WHERE status IN ('open','payment_claimed','paused','disputed')), 0)::bigint AS outstanding,
      COALESCE(sum(amount_paise - paid_paise) FILTER (WHERE status = 'open' AND due_date < ${today}::date), 0)::bigint AS overdue,
      count(*) FILTER (WHERE status = 'open' AND due_date < ${today}::date)::int AS overdue_count,
      COALESCE(sum(amount_paise) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', now())), 0)::bigint AS recovered_month,
      count(*) FILTER (WHERE status = 'disputed')::int AS disputed,
      count(*) FILTER (WHERE status = 'payment_claimed')::int AS claimed
    FROM invoices WHERE org_id = ${org.id}`;
  const [queue] = await sql`
    SELECT count(*) FILTER (WHERE status = 'pending_approval')::int AS pending,
           count(*) FILTER (WHERE status = 'held')::int AS held,
           count(*) FILTER (WHERE status = 'queued')::int AS queued,
           count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '7 days')::int AS sent_week
    FROM reminders WHERE org_id = ${org.id}`;
  const activity = await sql`
    SELECT actor, action, created_at FROM audit_log WHERE org_id = ${org.id} ORDER BY created_at DESC LIMIT 12`;

  const setupGaps = [
    !org.upi_id && 'Add your UPI ID so buyers can pay in one tap',
    !env.emailConfigured() && 'Email sending is not set up yet — routine reminders will come to your queue instead of auto-sending',
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Reminders run automatically every morning at 10:00 IST.</p>
        </div>
        <div className="row">
          <form action={runNow}><button className="btn" type="submit" disabled={org.kill_switch}>Run now</button></form>
          <form action={toggleKill}>
            <button className={org.kill_switch ? 'btn primary' : 'btn danger'} type="submit">
              {org.kill_switch ? 'Turn kill switch OFF' : 'Kill switch: stop everything'}
            </button>
          </form>
        </div>
      </div>
      <Flash msg={msg} err={err} />
      {setupGaps.map((g) => <div key={g} className="flash err">{g} — <Link href="/settings">settings</Link></div>)}

      <div className="grid">
        <div className="stat"><div className="label">Outstanding</div><div className="value">{formatINR(totals.outstanding)}</div></div>
        <div className="stat"><div className="label">Overdue ({totals.overdue_count} invoices)</div><div className="value">{formatINR(totals.overdue)}</div></div>
        <div className="stat"><div className="label">Recovered this month</div><div className="value">{formatINR(totals.recovered_month)}</div></div>
        <div className="stat"><div className="label">Reminders sent (7 days)</div><div className="value">{queue.sent_week}</div></div>
      </div>

      <div className="card">
        <h2>Needs you</h2>
        <ul>
          <li><Link href="/queue">{queue.pending} reminders waiting for your approval</Link></li>
          <li><Link href="/queue">{queue.held} held by safety checks</Link> (never sent until you act)</li>
          <li>{queue.queued} queued to auto-send</li>
          <li><Link href="/invoices?status=payment_claimed">{totals.claimed} buyers say they have paid</Link> — confirm when the money arrives</li>
          <li><Link href="/invoices?status=disputed">{totals.disputed} disputed invoices</Link> — reminders are stopped for these</li>
        </ul>
      </div>

      <div className="card">
        <h2>Recent activity</h2>
        {activity.length === 0 ? <p className="muted">Nothing yet. Start by adding invoices.</p> : (
          <div className="table-wrap"><table><tbody>
            {activity.map((a, i) => (
              <tr key={i}><td className="muted small">{new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td>{a.action}</td><td className="muted small">{a.actor}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </div>
    </>
  );
}
