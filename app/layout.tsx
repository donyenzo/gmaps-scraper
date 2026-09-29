import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Google Maps Scraper',
  description: 'Google Maps scraper powered by Serper.dev API',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
