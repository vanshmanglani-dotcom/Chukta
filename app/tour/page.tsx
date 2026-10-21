import type { Metadata } from 'next';
import { Tour } from '@/components/Tour';

export const metadata: Metadata = {
  title: 'Chukta — 60-second tour',
  description: 'See how Chukta chases unpaid invoices for Indian small businesses.',
};

export default function TourPage() {
  return <Tour />;
}
