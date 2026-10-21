import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { payPageUrl } from '@/lib/links';
import { composeMessage } from '@/lib/engine/compose';
import { STAGE_LABELS, type Stage } from '@/lib/engine/ladder';
import { Flash } from '@/components/Flash';
import { CopyButton } from '@/components/CopyButton';
import { approveEmail, editReminder, markSent, retryDraft, sendWhatsApp, skipReminder } from '../actions';

interface Row {
  id: string; stage: number; channel: 'email' | 'whatsapp'; mode: string; status: string;
  subject: string | null; body: string; hold_reason: string | null; error: string | null;
  created_at: string; sent_at: string | null;
  invoice_no: string; amount_paise: string; paid_paise: string; public_token: string;
  buyer_name: string; phone: string | null; email: string | null;
}

const MODE_LABEL: Record<string, string> = { auto: 'Auto', approve: 'Needs approval', manual: 'You send' };

function Item({ r }: { r: Row }) {
  const full = composeMessage(r.body, payPageUrl(r.public_token), r.channel);
  const outstanding = Number(r.amount_paise) - Number(r.paid_paise);
  const actionable = ['pending_approval', 'queued'].includes(r.status);
  return (
    <div className="card">
      <div className="spread">
        <div>
          <strong>{r.buyer_name}</strong> · invoice {r.invoice_no} · {formatINR(outstanding)}
          <div className="row small" style={{ marginTop: 4 }}>
            <span className="pill grey">{STAGE_LABELS[r.stage as Stage]}</span>
            <span className="pill">{r.channel === 'email' ? 'Email' : 'WhatsApp'}</span>
            <span className={r.status === 'held' ? 'pill danger' : 'pill warn'}>{r.status === 'held' ? 'Held' : MODE_LABEL[r.mode]}</span>
          </div>
        </div>
      </div>
      {r.hold_reason && <p className="small muted" style={{ marginTop: 8 }}>{r.hold_reason}</p>}
      {r.error && <p className="small" style={{ color: 'var(--danger)' }}>Last error: {r.error}</p>}
      {r.subject && r.channel === 'email' && <p className="small" style={{ marginTop: 8 }}><strong>Subject:</strong> {r.subject}</p>}
      <div className="message">{full}</div>
      <div className="row" style={{ marginTop: 10 }}>
        {actionable && r.channel === 'whatsapp' && r.phone && (
          <form action={sendWhatsApp}><input type="hidden" name="id" value={r.id} /><button className="btn primary small" type="submit">Open in WhatsApp</button></form>
        )}
        {actionable && r.channel === 'email' && r.email && (
          <form action={approveEmail}><input type="hidden" name="id" value={r.id} /><button className="btn primary small" type="submit">Approve & send email</button></form>
        )}
        {actionable && <CopyButton text={full} />}
        {actionable && (
          <form action={markSent}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">I sent it myself</button></form>
        )}
        {r.status === 'held' && (
          <form action={retryDraft}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">Re-draft with AI</button></form>
        )}
        <form action={skipReminder}><input type="hidden" name="id" value={r.id} /><button className="btn small" type="submit">Skip</button></form>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary>Edit message</summary>
        <form action={editReminder} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={r.id} />
          {r.channel === 'email' && <div className="field"><label>Subject</label><input name="subject" defaultValue={r.subject ?? ''} /></div>}
          <div className="field"><label>Message (the payment link is added automatically)</label><textarea name="body" defaultValue={r.body} /></div>
          <button className="btn small" type="submit">Save edit</button>
        </form>
      </details>
    </div>
  );
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { msg, err } = await searchParams;
  const { org } = await requireOrg();
  const rows = (await db()`
    SELECT r.id, r.stage, r.channel, r.mode, r.status, r.subject, r.body, r.hold_reason, r.error, r.created_at, r.sent_at,
           i.invoice_no, i.amount_paise, i.paid_paise, i.public_token, b.name AS buyer_name, b.phone, b.email
    FROM reminders r JOIN invoices i ON i.id = r.invoice_id JOIN buyers b ON b.id = r.buyer_id
    WHERE r.org_id = ${org.id} AND r.status IN ('pending_approval','held','queued')
    ORDER BY CASE r.status WHEN 'held' THEN 0 WHEN 'pending_approval' THEN 1 ELSE 2 END, r.created_at ASC
    LIMIT 100`) as Row[];
  const recent = await db()`
    SELECT r.status, r.channel, r.sent_at, r.created_at, i.invoice_no, b.name AS buyer_name
    FROM reminders r JOIN invoices i ON i.id = r.invoice_id JOIN buyers b ON b.id = r.buyer_id
    WHERE r.org_id = ${org.id} AND r.status IN ('sent','failed','skipped','cancelled')
    ORDER BY COALESCE(r.sent_at, r.created_at) DESC LIMIT 20`;

  return (
    <>
      <h1>Queue</h1>
      <p className="muted">Everything waiting on you. Held items failed a safety check and will never send on their own.</p>
      <Flash msg={msg} err={err} />
      {rows.length === 0 ? <div className="card muted">Nothing waiting. Use “Run now” on the dashboard to check for due invoices.</div> : rows.map((r) => <Item key={r.id} r={r} />)}
      <div className="card">
        <h2>Recently handled</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Buyer</th><th>Invoice</th><th>Channel</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {recent.map((x, i) => (
              <tr key={i}><td>{x.buyer_name}</td><td>{x.invoice_no}</td><td>{x.channel}</td><td>{x.status}</td>
                <td className="small muted">{new Date(x.sent_at ?? x.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
