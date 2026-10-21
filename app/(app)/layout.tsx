import Link from 'next/link';
import { requireOrg } from '@/lib/auth';
import { env, getGlobalKill } from '@/lib/config';
import { logout } from '../auth-actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  const platformKill = env.envKill() || (await getGlobalKill());
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/dashboard" className="logo">chuk<span>ta</span></Link>
        <nav className="nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/queue">Queue</Link>
          <Link href="/invoices">Invoices</Link>
          <Link href="/buyers">Buyers</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <span className="muted small">{org.name}</span>
        <form action={logout}><button className="btn small" type="submit">Log out</button></form>
      </header>
      {platformKill && <div className="banner-kill">Platform kill switch is ON. Nothing is being sent for anyone.</div>}
      {org.kill_switch && <div className="banner-kill">Your kill switch is ON. No reminders will be drafted or sent until you turn it off on the dashboard.</div>}
      {env.dryRun() && <div className="flash err">Dry-run mode: reminders are drafted but never sent.</div>}
      {children}
    </div>
  );
}
