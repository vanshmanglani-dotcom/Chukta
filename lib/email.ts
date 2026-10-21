import 'server-only';
import { env } from './config';

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string; retryable: boolean };

/** Sends a plain-text email through Resend. Returns a result instead of throwing. */
export async function sendEmail(opts: { to: string; subject: string; text: string; replyTo?: string }): Promise<SendResult> {
  if (!env.emailConfigured()) return { ok: false, error: 'Email provider not configured', retryable: false };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        reply_to: opts.replyTo,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${data.message ?? 'error'}`, retryable: res.status >= 500 || res.status === 429 };
    }
    return { ok: true, providerId: data.id ?? '' };
  } catch (err) {
    return { ok: false, error: `Email send failed: ${(err as Error).message}`, retryable: true };
  }
}
