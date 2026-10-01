import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kargo Hiring Dashboard',
  description: 'Upload CVs, see candidates ranked against Kargo’s hiring rubric, and send interview invites in one click.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
