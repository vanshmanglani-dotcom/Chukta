import { requireOrg } from '@/lib/auth';
import { env } from '@/lib/config';
import { Flash } from '@/components/Flash';
import { updateSettings } from '../actions';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { msg, err } = await searchParams;
  const { org } = await requireOrg();
  return (
    <>
      <h1>Settings</h1>
      <Flash msg={msg} err={err} />
      <form action={updateSettings}>
        <div className="card">
          <h2>Business</h2>
          <div className="form-grid">
            <div><label>Business name</label><input name="name" defaultValue={org.name} required /></div>
            <div><label>Sign reminders as</label><input name="sender_name" defaultValue={org.sender_name} required /></div>
            <div><label>UPI ID (where buyers pay)</label><input name="upi_id" defaultValue={org.upi_id ?? ''} placeholder="sharmatraders@okhdfcbank" /></div>
            <div><label>UPI payee name</label><input name="upi_payee_name" defaultValue={org.upi_payee_name ?? ''} /></div>
          </div>
        </div>
        <div className="card">
          <h2>MSME status</h2>
          <p className="muted small">
            Only Udyam-registered <strong>micro</strong> and <strong>small</strong> enterprises are covered by the 45-day payment rule.
            When set, escalation messages (which you always approve) may mention it factually. Otherwise the AI is never allowed to mention any law.
          </p>
          <div className="form-grid">
            <div><label>Enterprise type</label>
              <select name="enterprise_type" defaultValue={org.enterprise_type}>
                <option value="none">Not registered / not sure</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option>
              </select></div>
            <div><label>Udyam registration number</label><input name="udyam_number" defaultValue={org.udyam_number ?? ''} placeholder="UDYAM-MH-01-0000000" /></div>
          </div>
        </div>
        <div className="card">
          <h2>Safety limits</h2>
          <div className="form-grid">
            <div><label>Always ask me above (₹)</label><input name="approval_threshold" defaultValue={String(Number(org.approval_threshold_paise) / 100)} /></div>
            <div><label>Send from (hour, IST)</label><input name="quiet_start_hour" type="number" min={0} max={23} defaultValue={org.quiet_start_hour} /></div>
            <div><label>Send until (hour, IST)</label><input name="quiet_end_hour" type="number" min={1} max={24} defaultValue={org.quiet_end_hour} /></div>
            <div><label>Max auto-sends per day</label><input name="daily_send_cap" type="number" min={0} max={500} defaultValue={org.daily_send_cap} /></div>
            <div><label>Min days between messages to one buyer</label><input name="min_gap_days" type="number" min={1} max={30} defaultValue={org.min_gap_days} /></div>
            <div><label>Max reminders per invoice</label><input name="max_reminders_per_invoice" type="number" min={1} max={12} defaultValue={org.max_reminders_per_invoice} /></div>
          </div>
        </div>
        <button className="btn primary" type="submit">Save settings</button>
      </form>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>System status</h2>
        <ul className="small">
          <li>AI drafting: {env.aiConfigured() ? 'connected' : 'not configured — reminders will be held'}</li>
          <li>Email sending: {env.emailConfigured() ? 'connected' : 'not set up — routine reminders come to your queue'}</li>
          <li>WhatsApp: sent by you in one tap (opens WhatsApp with the message filled in)</li>
        </ul>
      </div>
    </>
  );
}
