'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { stageFor, STAGE_LABELS, type Stage } from '@/lib/engine/ladder';
import { decideMode } from '@/lib/engine/mode';
import { checkDraft } from '@/lib/engine/guardrails';
import { formatINR } from '@/lib/money';
import { daysBetween } from '@/lib/time';

// Demo data only. Nothing here touches the database or sends anything.
const TODAY = '2026-10-22';
const THRESHOLD = 1_00_000_00;
const SUPPLIER = 'Sharma Steel Traders';

const INVOICES = [
  { no: 'INV-2041', buyer: 'Gupta Distributors', amount: 48_500_00, due: '2026-10-15', relationship: 'regular' as const, email: true, phone: true, lang: 'Hinglish' },
  { no: 'INV-2033', buyer: 'Reliable Auto Parts', amount: 1_25_000_00, due: '2026-09-25', relationship: 'key' as const, email: false, phone: true, lang: 'English' },
  { no: 'INV-2050', buyer: 'New Age Retail', amount: 9_800_00, due: '2026-10-24', relationship: 'new' as const, email: true, phone: false, lang: 'English' },
  { no: 'INV-2012', buyer: 'Mehta Fabricators', amount: 2_21_000_00, due: '2026-08-30', relationship: 'regular' as const, email: true, phone: true, lang: 'Hindi' },
  { no: 'INV-2047', buyer: 'Om Hardware', amount: 78_000_00, due: '2026-10-10', relationship: 'regular' as const, email: false, phone: true, lang: 'Hinglish' },
];

const GOOD_DRAFT =
  'Namaste Gupta ji, ek chhota sa reminder — invoice INV-2041 ka ₹48,500 ka payment 7 din se pending hai. Agar already process ho gaya ho toh please bata dijiye. Koi query ho toh call kar lijiye. — Ramesh, Sharma Steel Traders';
const BAD_DRAFT =
  'Om Hardware, invoice INV-2047 for ₹78,000 is overdue. Pay today, otherwise we will go to the police and post about this on social media.';

const STEPS = [
  { title: 'Upload your unpaid invoices', text: 'Export from Tally or Excel and drop in a CSV. Every row is checked; one bad row and nothing is imported, so your ledger never ends up half-loaded.' },
  { title: 'See what is stuck', text: 'Chukta totals what you are owed, what is overdue, and what it has recovered this month.' },
  { title: 'It decides how to handle each buyer', text: 'Tone gets firmer as an invoice ages. Routine reminders to regular buyers go out automatically; key accounts, new buyers, big amounts and escalations always wait for you.' },
  { title: 'AI writes the reminder in their language', text: 'English, Hindi or Hinglish. Every draft is checked: exact invoice number and amount, no threats, no invented links.' },
  { title: 'Bad drafts are caught, never sent', text: 'If the AI ever writes something coercive or wrong, the safety check holds it for you instead of sending it.' },
  { title: 'You approve in one tap', text: 'For WhatsApp, Chukta opens the chat with the message already typed. The payment link is added automatically.' },
  { title: 'Your buyer pays by UPI', text: 'The link opens a clean page with the exact amount and a UPI QR code. Any UPI app works.' },
  { title: 'Reminders stop on their own', text: 'If the buyer says they have paid, raises a dispute or opts out, every pending reminder for them is cancelled instantly.' },
  { title: 'One switch stops everything', text: 'Something feels off? The kill switch halts all drafting and sending immediately, and it is checked again before every single message.' },
];

const STEP_MS = 7000;

function useTyped(text: string, active: boolean, speed = 18) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) { setN(0); return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setN(text.length); return; }
    setN(0);
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 2)), speed);
    return () => clearInterval(id);
  }, [text, active, speed]);
  return text.slice(0, n);
}

function useCount(target: number, active: boolean) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) { setV(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return v;
}

function Reveal({ i, active, children }: { i: number; active: boolean; children: React.ReactNode }) {
  return (
    <tr style={{ opacity: active ? 1 : 0, transition: `opacity .4s ${i * 0.35}s` }}>{children}</tr>
  );
}

export function Tour() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [qr, setQr] = useState<string | null>(null);
  const done = step >= STEPS.length;

  useEffect(() => {
    if (!playing || done) return;
    const id = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [step, playing, done]);

  useEffect(() => {
    QRCode.toDataURL('upi://pay?pa=sharmasteel@okhdfcbank&pn=Sharma%20Steel%20Traders&am=48500.00&cu=INR&tn=Invoice%20INV-2041', { margin: 1, width: 200 })
      .then(setQr).catch(() => setQr(null));
  }, []);

  // Real engine logic, run on demo data.
  const rows = useMemo(() => INVOICES.map((inv) => {
    const stage = stageFor(inv.due, TODAY) as Stage;
    const d = decideMode({
      stage, relationship: inv.relationship, override: null, outstandingPaise: inv.amount,
      approvalThresholdPaise: THRESHOLD, hasEmail: inv.email, hasPhone: inv.phone,
    });
    return { ...inv, stage, overdue: daysBetween(inv.due, TODAY), decision: d };
  }), []);

  const goodCheck = checkDraft({ stage: 1, channel: 'whatsapp', body: GOOD_DRAFT, invoiceNo: 'INV-2041', amountFormatted: '₹48,500', legalMentionAllowed: false });
  const badCheck = checkDraft({ stage: 2, channel: 'whatsapp', body: BAD_DRAFT, invoiceNo: 'INV-2047', amountFormatted: '₹78,000', legalMentionAllowed: false });

  const total = INVOICES.reduce((s, i) => s + i.amount, 0);
  const overdue = rows.filter((r) => r.overdue > 0).reduce((s, r) => s + r.amount, 0);
  const outstandingCount = useCount(total, step === 1);
  const overdueCount = useCount(overdue, step === 1);
  const typed = useTyped(GOOD_DRAFT, step === 3);
  const badTyped = useTyped(BAD_DRAFT, step === 4, 12);

  const [paidClicked, setPaidClicked] = useState(false);
  const [killOn, setKillOn] = useState(false);
  const [waOpened, setWaOpened] = useState(false);
  useEffect(() => {
    setPaidClicked(false); setKillOn(false); setWaOpened(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (step === 5) timers.push(setTimeout(() => setWaOpened(true), 2500));
    if (step === 7) timers.push(setTimeout(() => setPaidClicked(true), 2500));
    if (step === 8) timers.push(setTimeout(() => setKillOn(true), 2500));
    return () => timers.forEach(clearTimeout);
  }, [step]);

  const pill = (mode: string) => mode === 'auto' ? 'pill' : mode === 'approve' ? 'pill warn' : 'pill grey';
  const modeLabel: Record<string, string> = { auto: 'Auto email', approve: 'Needs you', manual: 'You send' };

  return (
    <main className="tour">
      <header className="spread" style={{ marginBottom: 16 }}>
        <Link href="/" className="logo">chuk<span>ta</span></Link>
        <span className="muted small">Product tour · demo data · nothing is sent</span>
      </header>

      <div className="tour-progress" aria-hidden>
        {STEPS.map((_, i) => (
          <span key={i} className={i < step ? 'seg done' : i === step ? 'seg on' : 'seg'}>
            {i === step && playing && !done && <i style={{ animationDuration: `${STEP_MS}ms` }} />}
          </span>
        ))}
      </div>

      {!done ? (
        <div className="tour-grid">
          <section className="tour-caption" aria-live="polite">
            <p className="muted small">Step {step + 1} of {STEPS.length}</p>
            <h1>{STEPS[step].title}</h1>
            <p>{STEPS[step].text}</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn small" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
              <button className="btn small" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
              <button className="btn primary small" onClick={() => setStep((s) => s + 1)}>Next</button>
            </div>
          </section>

          <section className="tour-screen card" key={step}>
            {step === 0 && (
              <>
                <p className="small muted">invoices.csv · {INVOICES.length} rows</p>
                <div className="table-wrap"><table>
                  <thead><tr><th>Invoice</th><th>Buyer</th><th>Amount</th><th>Due</th></tr></thead>
                  <tbody>{INVOICES.map((inv, i) => (
                    <Reveal key={inv.no} i={i} active><td>{inv.no}</td><td>{inv.buyer}</td><td>{formatINR(inv.amount)}</td><td>{inv.due}</td></Reveal>
                  ))}</tbody>
                </table></div>
                <div className="flash" style={{ marginTop: 12, animation: 'fadein .4s 2s both' }}>Imported {INVOICES.length} invoices · 0 errors</div>
              </>
            )}

            {step === 1 && (
              <div className="grid" style={{ marginBottom: 0 }}>
                <div className="stat"><div className="label">Outstanding</div><div className="value">{formatINR(outstandingCount)}</div></div>
                <div className="stat"><div className="label">Overdue ({rows.filter((r) => r.overdue > 0).length} invoices)</div><div className="value" style={{ color: 'var(--danger)' }}>{formatINR(overdueCount)}</div></div>
                <div className="stat"><div className="label">Oldest overdue</div><div className="value">{Math.max(...rows.map((r) => r.overdue))} days</div></div>
                <div className="stat"><div className="label">Recovered this month</div><div className="value">₹0</div></div>
              </div>
            )}

            {step === 2 && (
              <div className="table-wrap"><table>
                <thead><tr><th>Buyer</th><th>Overdue</th><th>Stage</th><th>How it goes out</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <Reveal key={r.no} i={i} active>
                    <td>{r.buyer}<div className="small muted">{formatINR(r.amount)} · {r.relationship}</div></td>
                    <td>{r.overdue > 0 ? `${r.overdue} days` : `due in ${-r.overdue}`}</td>
                    <td><span className="pill grey">{STAGE_LABELS[r.stage]}</span></td>
                    <td>{r.decision.ok && <><span className={pill(r.decision.mode)}>{modeLabel[r.decision.mode]}</span><div className="small muted">{r.decision.reason}</div></>}</td>
                  </Reveal>
                ))}</tbody>
              </table></div>
            )}

            {step === 3 && (
              <>
                <p className="small muted">Gupta Distributors · INV-2041 · Gentle reminder · Hinglish</p>
                <div className="bubble">{typed}<span className="caret" /></div>
                <div className="row" style={{ marginTop: 12, opacity: typed.length === GOOD_DRAFT.length ? 1 : 0, transition: 'opacity .3s' }}>
                  {goodCheck.ok && ['Invoice number exact', 'Amount exact', 'No threats', 'No invented links'].map((c) => (
                    <span key={c} className="pill">✓ {c}</span>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <p className="small muted">Om Hardware · INV-2047 · Firm follow-up</p>
                <div className="bubble bad">{badTyped}</div>
                {!badCheck.ok && badTyped.length === BAD_DRAFT.length && (
                  <div className="flash err" style={{ marginTop: 12, animation: 'fadein .3s both' }}>
                    <strong>Held — not sent.</strong> {badCheck.reasons.join(' · ')}
                  </div>
                )}
              </>
            )}

            {step === 5 && (
              <div className="tour-two">
                <div>
                  <p className="small"><strong>Reliable Auto Parts</strong> · INV-2033 · ₹1,25,000</p>
                  <div className="row small" style={{ margin: '6px 0 10px' }}><span className="pill grey">Escalation</span><span className="pill warn">Needs you</span></div>
                  <div className="message small">Dear Mr. Kapoor, invoice INV-2033 for ₹1,25,000 is now 27 days overdue. Could you confirm a payment date this week?{'\n'}— Ramesh{'\n\n'}View invoice & pay: chukta…/p/3f9a…</div>
                  <button className={`btn primary small ${waOpened ? 'pressed' : ''}`} style={{ marginTop: 10 }}>Open in WhatsApp</button>
                </div>
                <div className="phone">
                  <div className="phone-top">Reliable Auto Parts</div>
                  {waOpened && <div className="wa">Dear Mr. Kapoor, invoice INV-2033 for ₹1,25,000 is now 27 days overdue. Could you confirm a payment date this week? — Ramesh<br /><span className="link">View invoice & pay</span></div>}
                </div>
              </div>
            )}

            {step === 6 && (
              <div className="paymock">
                <p className="muted small">Invoice from</p>
                <h2 style={{ marginBottom: 2 }}>{SUPPLIER}</h2>
                <p className="muted small">To Gupta Distributors · Invoice INV-2041</p>
                <div className="stat" style={{ margin: '10px 0' }}><div className="label">Amount due</div><div className="value">₹48,500</div></div>
                <span className="btn primary" style={{ width: '100%', justifyContent: 'center' }}>Pay with any UPI app</span>
                {qr && <img className="qr" src={qr} alt="Demo UPI QR code" />}
              </div>
            )}

            {step === 7 && (
              <div className="tour-two">
                <div className="paymock">
                  <p className="small"><strong>Buyer&apos;s view</strong></p>
                  <span className={`btn small ${paidClicked ? 'pressed' : ''}`}>I have already paid</span>
                  {paidClicked && <div className="flash" style={{ marginTop: 10 }}>Thanks! We have told the supplier. Reminders have stopped.</div>}
                </div>
                <div>
                  <p className="small"><strong>Your view</strong></p>
                  <table><tbody>
                    <tr><td>INV-2041</td><td><span className={paidClicked ? 'pill warn' : 'pill'}>{paidClicked ? 'buyer says paid' : 'open'}</span></td></tr>
                    <tr><td>Next reminder</td><td>{paidClicked ? <span className="pill grey">cancelled</span> : <span className="pill">scheduled</span>}</td></tr>
                  </tbody></table>
                  {paidClicked && <p className="small muted" style={{ marginTop: 8 }}>Confirm when the money lands, or resume if it doesn&apos;t.</p>}
                </div>
              </div>
            )}

            {step === 8 && (
              <>
                <div className="spread">
                  <strong>Dashboard</strong>
                  <span className={`btn small ${killOn ? 'primary' : 'danger'} ${killOn ? 'pressed' : ''}`}>{killOn ? 'Turn kill switch OFF' : 'Kill switch: stop everything'}</span>
                </div>
                {killOn && <div className="banner-kill" style={{ marginTop: 12 }}>Your kill switch is ON. No reminders will be drafted or sent.</div>}
                <table style={{ marginTop: 8 }}><tbody>
                  <tr><td>Queued auto-emails</td><td>{killOn ? <span className="pill danger">halted</span> : <span className="pill">3 ready</span>}</td></tr>
                  <tr><td>Tomorrow&apos;s 10:00 run</td><td>{killOn ? <span className="pill danger">skipped</span> : <span className="pill">on</span>}</td></tr>
                </tbody></table>
              </>
            )}
          </section>
        </div>
      ) : (
        <section className="card" style={{ textAlign: 'center', padding: 32 }}>
          <h1>That&apos;s Chukta.</h1>
          <p className="muted">Polite reminders that go out on time, with you in control of anything sensitive.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link className="btn primary" href="/signup">Start free</Link>
            <button className="btn" onClick={() => { setStep(0); setPlaying(true); }}>Watch again</button>
          </div>
        </section>
      )}
    </main>
  );
}
