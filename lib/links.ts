import { env } from './config';

export function payPageUrl(token: string): string {
  return `${env.appUrl()}/p/${token}`;
}

/** UPI deep link (NPCI spec). Amount in rupees with 2 decimals. */
export function upiLink(opts: { upiId: string; payee: string; amountPaise: number; note: string }): string {
  const params = new URLSearchParams({
    pa: opts.upiId,
    pn: opts.payee,
    am: (opts.amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: opts.note.slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
}

/** Normalise an Indian phone number to digits with country code, or null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10) d = '91' + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
