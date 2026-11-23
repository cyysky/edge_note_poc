import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Displayer',
  description: 'A small notes app on Next.js, NestJS and SQLite.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111318' },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/">Notes</Link>
          <Link href="/chat">Chat</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
