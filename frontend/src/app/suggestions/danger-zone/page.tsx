'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, CopyMinus, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { clearProcessedLexemes, clearSuggestions, deduplicatePendingSuggestions } from '@/lib/api';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DangerZonePage() {
  const router = useRouter();
  const [clearingSuggestions, setClearingSuggestions] = useState(false);
  const [clearingProcessed, setClearingProcessed] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);

  async function handleClearSuggestions() {
    setClearingSuggestions(true);
    try {
      const result = await clearSuggestions();
      toast.success(
        `Cleared ${result.deleted} suggestion${result.deleted !== 1 ? 's' : ''}. You can now run the pipeline again.`,
      );
      router.push('/suggestions');
    } catch {
      toast.error('Failed to clear suggestions.');
    } finally {
      setClearingSuggestions(false);
    }
  }

  async function handleClearProcessed() {
    setClearingProcessed(true);
    try {
      const result = await clearProcessedLexemes();
      toast.success(
        `Cleared ${result.deleted} processed lexeme record${
          result.deleted !== 1 ? 's' : ''
        }. The next pipeline run will re-scan all candidates.`,
      );
      router.push('/suggestions');
    } catch {
      toast.error('Failed to clear processed lexemes.');
    } finally {
      setClearingProcessed(false);
    }
  }

  async function handleDeduplicate() {
    setDeduplicating(true);
    try {
      const result = await deduplicatePendingSuggestions();
      toast.success(
        `Removed ${result.deleted} duplicate pending suggestion${result.deleted !== 1 ? 's' : ''}.`,
      );
      if (result.deleted > 0) router.push('/suggestions');
    } catch {
      toast.error('Failed to remove duplicates.');
    } finally {
      setDeduplicating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/suggestions" className="hover:text-foreground transition-colors">
            ← Suggestions
          </Link>
          <span>/</span>
          <span className="text-foreground">Danger zone</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <AlertTriangle className="h-8 w-8 text-destructive shrink-0" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Danger zone</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Irreversible or heavy actions. Use with care.
            </p>
          </div>
        </div>
      </div>

      <Separator className="bg-destructive/20" />

      <div className="flex flex-col gap-6">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Clear suggestions</CardTitle>
            <CardDescription>
              Permanently delete every suggestion from the database. Their linked processed-lexeme
              records are also removed so the pipeline can re-fetch those lexemes. Use this after
              rule or prompt changes to start fresh. Applied edits on Wikidata are not affected.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-row justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={clearingSuggestions} className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  {clearingSuggestions ? 'Clearing…' : 'Clear suggestions'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all suggestions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes every suggestion and allows the pipeline to re-scan
                    those lexemes. This cannot be undone. Applied suggestions on Wikidata are not
                    affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearSuggestions}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear suggestions
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>

        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle>Remove duplicate pending suggestions</CardTitle>
            <CardDescription>
              If the same lexeme appears twice in the list (same type, both pending), this keeps one
              and deletes the extras. Use this to fix duplicate rows; the database will then enforce
              at most one pending suggestion per lexeme and type.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-row justify-end">
            <Button
              variant="outline"
              className="gap-2 border-amber-500/50 hover:bg-amber-500/10"
              disabled={deduplicating}
              onClick={handleDeduplicate}
            >
              <CopyMinus className="h-4 w-4" />
              {deduplicating ? 'Removing…' : 'Remove duplicates'}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Clear processed state</CardTitle>
            <CardDescription>
              Clear the internal record of which lexemes have already been scanned. No suggestions
              are deleted. The next pipeline run will re-fetch and re-evaluate candidates from
              Wikidata, which can be slow if the list is large.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-row justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={clearingProcessed} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  {clearingProcessed ? 'Clearing…' : 'Clear processed state'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear processed lexemes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears the pipeline’s memory of scanned lexemes. No suggestions are
                    deleted. The next run may re-fetch and re-evaluate many entities from Wikidata.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearProcessed}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear processed state
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
