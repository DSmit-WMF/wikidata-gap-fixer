import './globals.css';

import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: 'Wikidata Gap Fixer',
  description: 'AI-assisted suggestions for Wikidata lexeme gaps',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', inter.variable)}>
      <body className="min-h-screen bg-background antialiased">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
