import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'OpenAnalytics',
  description: 'Open-source coding-agent usage analytics',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
