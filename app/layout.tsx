import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chukta — get paid on time',
  description: 'AI payment reminders for Indian small businesses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
