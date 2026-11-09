import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koya Clinic — Book a Visit',
  description: 'Book a clinic appointment in under a minute. Instant confirmation, free cancellation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
