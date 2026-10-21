import Link from 'next/link';
import { signup } from '../auth-actions';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <main className="center">
      <p className="logo">chuk<span>ta</span></p>
      <div className="card">
        <h2>Create your account</h2>
        {err && <div className="flash err">{err}</div>}
        <form action={signup}>
          <div className="field"><label>Business name</label><input name="business" required placeholder="Sharma Traders" /></div>
          <div className="field"><label>Your name (used to sign reminders)</label><input name="name" required /></div>
          <div className="field"><label>Email</label><input name="email" type="email" required autoComplete="email" /></div>
          <div className="field"><label>Password (8+ characters)</label><input name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
          <button className="btn primary" type="submit">Create account</button>
        </form>
      </div>
      <p className="muted small">Have an account? <Link href="/login">Log in</Link></p>
    </main>
  );
}
