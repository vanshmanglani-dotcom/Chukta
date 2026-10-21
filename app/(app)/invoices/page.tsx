import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { daysBetween, istToday, toDateStr } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { addInvoice, importCsv, invoiceAction } from '../actions';

const STATUS_PILL: Record<string, string> = {
  open: 'pill', payment_claimed: 'pill warn', paid: 'pill grey', disputed: 'pill danger', paused: 'pill grey', written_off: 'pill grey',
};

const ACTIONS: Record<string, { action: string; label: string }[]> = {
  open: [{ action: 'mark_paid', label: 'Paid' }, { action: 'pause', label: 'Pause' }, { action: 'write_off', label: 'Write off' }],
  payment_claimed: [{ action: 'mark_paid', label: 'Confirm paid' }, { action: 'resume', label: 'Not received — resume' }],
  disputed: [{ action: 'resume', label: 'Resolved — resume' }, { action: 'mark_paid', label: 'Paid' }, { action: 'write_off', label: 'Write off' }],
  paused: [{ action: 'resume', label: 'Resume' }, { action: 'mark_paid', label: 'Paid' }],
  paid: [], written_off: [],
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string; status?: string }> }) {
  const { msg, err, status } = await searchParams;
  const { org } = await requireOrg();
  const today = istToday();
  const filter = status && Object.keys(ACTIONS).includes(status) ? status : null;
  const rows = await db()`
    SELECT i.id, i.invoice_no, i.amount_paise, i.paid_paise, i.due_date, i.status, i.dispute_reason, b.name AS buyer_name,
           (SELECT count(*)::int FROM reminders r WHERE r.invoice_id = i.id AND r.status = 'sent') AS sent_count
    FROM invoices i JOIN buyers b ON b.id = i.buyer_id
    WHERE i.org_id = ${org.id} AND (${filter}::text IS NULL OR i.status = ${filter})
    ORDER BY CASE i.status WHEN 'payment_claimed' THEN 0 WHEN 'disputed' THEN 1 WHEN 'open' THEN 2 ELSE 3 END, i.due_date ASC
    LIMIT 500`;

  return (
    <>
      <h1>Invoices</h1>
      <Flash msg={msg} err={err} />
      <div className="card">
        <h2>Import from CSV</h2>
        <p className="muted small">
          Columns: <code>invoice_no, buyer_name, amount, issue_date, due_date</code> and optionally{' '}
          <code>buyer_phone, buyer_email, buyer_language (en/hi/hinglish), relationship (key/regular/new)</code>.
          Dates as YYYY-MM-DD or DD/MM/YYYY. If any row has an error, nothing is imported. Existing invoice numbers are never overwritten.
        </p>
        <form action={importCsv} className="row">
          <input type="file" name="file" accept=".csv,text/csv" required style={{ maxWidth: 320 }} />
          <button className="btn primary" type="submit">Import</button>
          <a className="btn" href="/sample-invoices.csv" download>Download sample</a>
        </form>
      </div>

      <details className="card">
        <summary><strong>Add one invoice</strong></summary>
        <form action={addInvoice} style={{ marginTop: 12 }}>
          <div className="form-grid">
            <div><label>Invoice no.</label><input name="invoice_no" required /></div>
            <div><label>Buyer name</label><input name="buyer_name" required /></div>
            <div><label>Amount (₹)</label><input name="amount" required inputMode="decimal" /></div>
            <div><label>Issue date</label><input name="issue_date" type="date" required /></div>
            <div><label>Due date</label><input name="due_date" type="date" required /></div>
            <div><label>Buyer phone</label><input name="buyer_phone" inputMode="tel" /></div>
            <div><label>Buyer email</label><input name="buyer_email" type="email" /></div>
            <div><label>Language</label><select name="buyer_language"><option value="en">English</option><option value="hinglish">Hinglish</option><option value="hi">Hindi</option></select></div>
            <div><label>Relationship</label><select name="relationship"><option value="regular">Regular</option><option value="key">Key account</option><option value="new">New</option></select></div>
          </div>
          <button className="btn primary" type="submit" style={{ marginTop: 12 }}>Add invoice</button>
        </form>
      </details>

      <div className="card">
        <div className="spread"><h2>{filter ? `Invoices: ${filter.replace('_', ' ')}` : 'All invoices'}</h2>{filter && <a href="/invoices" className="small">Show all</a>}</div>
        {rows.length === 0 ? <p className="muted">No invoices yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Invoice</th><th>Buyer</th><th>Outstanding</th><th>Due</th><th>Status</th><th>Reminders</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const due = toDateStr(r.due_date);
                const overdue = daysBetween(due, today);
                return (
                  <tr key={r.id}>
                    <td>{r.invoice_no}</td>
                    <td>{r.buyer_name}</td>
                    <td>{formatINR(Number(r.amount_paise) - Number(r.paid_paise))}</td>
                    <td>{due}{r.status === 'open' && overdue > 0 && <div className="small" style={{ color: 'var(--danger)' }}>{overdue} days overdue</div>}</td>
                    <td><span className={STATUS_PILL[r.status]}>{r.status.replace('_', ' ')}</span>{r.dispute_reason && <div className="small muted">“{r.dispute_reason}”</div>}</td>
                    <td>{r.sent_count}</td>
                    <td><div className="row">
                      {ACTIONS[r.status].map((a) => (
                        <form key={a.action} action={invoiceAction}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value={a.action} />
                          <button className="btn small" type="submit">{a.label}</button>
                        </form>
                      ))}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
