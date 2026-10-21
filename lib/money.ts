/** Format paise as Indian rupees, e.g. 12500000 -> "₹1,25,000". Keeps paise only when non-zero. */
export function formatINR(paise: number | bigint | string): string {
  const p = Number(paise);
  const rupees = p / 100;
  const hasPaise = p % 100 !== 0;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Parse a user-entered rupee amount ("1,25,000.50", "₹ 4500") into integer paise. Returns null if invalid. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = String(input).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}
