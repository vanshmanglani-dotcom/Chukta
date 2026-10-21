import Link from 'next/link';
import { login } from '../auth-actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <main className="center">
      <p className="logo">chuk<span>ta</span></p>
      <div className="card">
        <h2>Log in</h2>
        {err && <div className="flash err">{err}</div>}
        <form action={login}>
          <div className="field"><label>Email</label><input name="email" type="email" required autoComplete="email" /></div>
          <div className="field"><label>Password</label><input name="password" type="password" required autoComplete="current-password" /></div>
          <button className="btn primary" type="submit">Log in</button>
        </form>
      </div>
      <p className="muted small">New here? <Link href="/signup">Create an account</Link></p>
    </main>
  );
}
