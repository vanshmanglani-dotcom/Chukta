import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { upiLink } from '@/lib/links';
import { toDateStr } from '@/lib/time';
import { claimPaid, optOut, raiseDispute } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invoice payment', robots: { index: false, follow: false } };

const DONE: Record<string, string> = {
  paid: 'Thank you! We have told the supplier. Reminders for this invoice have stopped.',
  dispute: 'Your concern has been sent to the supplier. Reminders for this invoice have stopped until they respond.',
  optout: 'You will not receive any more reminders from this supplier through Chukta.',
};

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const rows = await db()`
    SELECT i.invoice_no, i.amount_paise, i.paid_paise, i.issue_date, i.due_date, i.status,
           o.name AS org_name, o.upi_id, o.upi_payee_name, b.name AS buyer_name
    FROM invoices i JOIN orgs o ON o.id = i.org_id JOIN buyers b ON b.id = i.buyer_id
    WHERE i.public_token = ${token}`;
  const inv = rows[0];
  if (!inv) notFound();

  const outstanding = Number(inv.amount_paise) - Number(inv.paid_paise);
  const payable = inv.status === 'open' || inv.status === 'paused';
  const link = payable && inv.upi_id
    ? upiLink({ upiId: inv.upi_id, payee: inv.upi_payee_name || inv.org_name, amountPaise: outstanding, note: `Invoice ${inv.invoice_no}` })
    : null;
  const qr = link ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : null;

  return (
    <main className="pay">
      <div className="card">
        <p className="muted small">Invoice from</p>
        <h1>{inv.org_name}</h1>
        <p className="muted">To {inv.buyer_name} · Invoice {inv.invoice_no}</p>
        {done && DONE[done] && <div className="flash">{DONE[done]}</div>}

        {inv.status === 'paid' && <div className="flash">This invoice is marked as paid. Thank you.</div>}
        {inv.status === 'payment_claimed' && !done && <div className="flash">You have told us this is paid. The supplier will confirm once it arrives.</div>}
        {inv.status === 'disputed' && !done && <div className="flash">This invoice is under discussion with the supplier.</div>}

        {payable && (
          <>
            <div className="stat" style={{ margin: '12px 0' }}>
              <div className="label">Amount due</div>
              <div className="value">{formatINR(outstanding)}</div>
              <div className="small muted">Due {toDateStr(inv.due_date)}</div>
            </div>
            {link ? (
              <>
                <a className="btn primary" href={link} style={{ width: '100%', justifyContent: 'center' }}>Pay with any UPI app</a>
                {qr && <img className="qr" src={qr} alt="UPI QR code" />}
                <p className="small muted" style={{ textAlign: 'center' }}>Paying to {inv.upi_payee_name || inv.org_name} ({inv.upi_id}). Check the name in your UPI app before paying.</p>
              </>
            ) : (
              <p className="muted">Please pay using the bank details on your invoice.</p>
            )}

            <details style={{ marginTop: 16 }}>
              <summary>I have already paid</summary>
              <form action={claimPaid} style={{ marginTop: 8 }}>
                <input type="hidden" name="token" value={token} />
                <div className="field"><label>UTR / reference (optional)</label><input name="reference" maxLength={100} /></div>
                <button className="btn small" type="submit">Tell the supplier</button>
              </form>
            </details>
            <details style={{ marginTop: 8 }}>
              <summary>Something is wrong with this invoice</summary>
              <form action={raiseDispute} style={{ marginTop: 8 }}>
                <input type="hidden" name="token" value={token} />
                <div className="field"><label>What is the issue?</label><textarea name="reason" maxLength={500} required /></div>
                <button className="btn small" type="submit">Send to supplier</button>
              </form>
            </details>
          </>
        )}
        <details style={{ marginTop: 8 }}>
          <summary>Stop reminders from this supplier</summary>
          <form action={optOut} style={{ marginTop: 8 }}>
            <input type="hidden" name="token" value={token} />
            <p className="small muted">You will stop getting automated reminders. The amount may still be due.</p>
            <button className="btn small" type="submit">Stop reminders</button>
          </form>
        </details>
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>
        Sent with <a href="/">Chukta</a> — small businesses get paid on time, politely.
      </p>
    </main>
  );
}
