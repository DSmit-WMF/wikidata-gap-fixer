'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { fetchMe, loginUrl, logoutUrl, type User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export function SiteHeader() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight">
            Wikidata Gap Fixer
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/suggestions" className="transition-colors hover:text-foreground">
              Suggestions
            </Link>
            <Link
              href="/suggestions/danger-zone"
              className="flex items-center gap-1.5 transition-colors hover:text-destructive text-destructive/90"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Danger zone
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {user === undefined ? null : user ? (
            <>
              <span className="text-sm text-muted-foreground hidden sm:block">{user.username}</span>
              <Button variant="outline" size="sm" asChild>
                <a href={logoutUrl()}>Log out</a>
              </Button>
            </>
          ) : (
            <Button size="sm" asChild>
              <a href={loginUrl()}>Log in with Wikidata</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
