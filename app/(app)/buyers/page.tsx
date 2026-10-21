import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { toDateStr } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { updateBuyer } from '../actions';

export default async function BuyersPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { msg, err } = await searchParams;
  const { org } = await requireOrg();
  const rows = await db()`
    SELECT b.*,
      COALESCE((SELECT sum(amount_paise - paid_paise) FROM invoices i WHERE i.buyer_id = b.id AND i.status IN ('open','payment_claimed','paused','disputed')), 0)::bigint AS outstanding
    FROM buyers b WHERE b.org_id = ${org.id} ORDER BY outstanding DESC, b.name LIMIT 500`;

  return (
    <>
      <h1>Buyers</h1>
      <p className="muted">
        How each buyer is handled. <strong>Key</strong> and <strong>new</strong> buyers always need your approval.
        <strong> Regular</strong> buyers with an email get routine reminders automatically. Escalations and amounts above{' '}
        {formatINR(org.approval_threshold_paise)} always need you, whatever is set here.
      </p>
      <Flash msg={msg} err={err} />
      {rows.length === 0 && <div className="card muted">Buyers appear here when you add invoices.</div>}
      {rows.map((b) => (
        <details key={b.id} className="card">
          <summary>
            <strong>{b.name}</strong> · {formatINR(b.outstanding)} outstanding · {b.relationship}
            {b.do_not_contact && <span className="pill danger" style={{ marginLeft: 8 }}>Do not contact</span>}
            {b.opted_out_at && <span className="pill danger" style={{ marginLeft: 8 }}>Opted out</span>}
          </summary>
          <form action={updateBuyer} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={b.id} />
            <div className="form-grid">
              <div><label>Contact person</label><input name="contact_name" defaultValue={b.contact_name ?? ''} /></div>
              <div><label>Phone (WhatsApp)</label><input name="phone" defaultValue={b.phone ?? ''} inputMode="tel" /></div>
              <div><label>Email</label><input name="email" type="email" defaultValue={b.email ?? ''} /></div>
              <div><label>Language</label>
                <select name="language" defaultValue={b.language}><option value="en">English</option><option value="hinglish">Hinglish</option><option value="hi">Hindi</option></select></div>
              <div><label>Relationship</label>
                <select name="relationship" defaultValue={b.relationship}><option value="regular">Regular</option><option value="key">Key account</option><option value="new">New</option></select></div>
              <div><label>Sending mode</label>
                <select name="mode_override" defaultValue={b.mode_override ?? 'default'}>
                  <option value="default">Decide from profile</option>
                  <option value="auto">Auto (routine reminders only)</option>
                  <option value="approve">Always ask me</option>
                  <option value="manual">I send everything myself</option>
                </select></div>
              <div><label>Pause reminders until</label><input type="date" name="paused_until" defaultValue={b.paused_until ? toDateStr(b.paused_until) : ''} /></div>
            </div>
            <label className="row" style={{ marginTop: 12, color: 'var(--text)' }}>
              <input type="checkbox" name="do_not_contact" defaultChecked={b.do_not_contact} style={{ width: 'auto' }} /> Never contact this buyer
            </label>
            {b.opted_out_at && <p className="small muted">This buyer opted out from the payment page. Reminders stay off for them.</p>}
            <button className="btn primary small" type="submit" style={{ marginTop: 12 }}>Save</button>
          </form>
        </details>
      ))}
    </>
  );
}
