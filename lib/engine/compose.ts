/** Adds the deterministic footer (official payment link) to an approved message body. */
export function composeMessage(body: string, payUrl: string, channel: 'email' | 'whatsapp'): string {
  if (channel === 'whatsapp') {
    return `${body.trim()}\n\nView invoice & pay: ${payUrl}`;
  }
  return `${body.trim()}\n\n—\nView the invoice and pay by UPI: ${payUrl}\nAlready paid, or something wrong with this invoice? Tell us on the same page and reminders will stop.`;
}
