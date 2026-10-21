import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function Home() {
  if (await getSession()) redirect('/dashboard');
  return (
    <main className="hero">
      <p className="logo">chuk<span>ta</span></p>
      <h1>Stop chasing payments. Let Chukta follow up for you.</h1>
      <p className="muted">
        Upload your unpaid invoices. Chukta writes polite, firm reminders in English, Hindi or Hinglish,
        sends routine ones automatically, and asks you before anything sensitive goes out. Buyers pay by UPI in one tap.
      </p>
      <div className="row" style={{ marginTop: 20 }}>
        <Link className="btn primary" href="/signup">Start free</Link>
        <Link className="btn" href="/login">Log in</Link>
      </div>
      <ul className="muted small" style={{ marginTop: 32 }}>
        <li>You approve every escalation and every large invoice</li>
        <li>One switch stops all reminders instantly</li>
        <li>Buyers can mark paid, dispute or opt out — reminders stop at once</li>
      </ul>
    </main>
  );
}
