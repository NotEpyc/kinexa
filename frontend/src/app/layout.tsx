import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kinexa — Live Squat Coach',
  description: 'Live squat movement feedback with therapist-set range of motion.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
