import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NEXORA OFFICE 3D — Interactive headquarters',
  description:
    'An interactive 3D corporate headquarters with selectable floors and rooms, agent workstations and an honest operational task layer.',
  applicationName: 'NEXORA OFFICE 3D',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#070a0d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
