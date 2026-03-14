'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import {
  fetchSuggestions,
  fetchPipelineStatus,
  triggerGeneration,
  type PipelineProgress,
  type Suggestion,
} from '@/lib/api';
import {
  LANGUAGES,
  getTypesForLanguage,
  getSuggestionTypeBadgeClass,
} from '@/lib/suggestion-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { suggestionTypeLabel } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';

function confidenceLabel(val: number | null): string {
  if (val === null) return '—';
  return `${Math.round(val * 100)}%`;
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'success' | 'destructive' | 'outline' {
  if (status === 'pending') return 'default';
  if (status === 'applied') return 'success';
  if (status === 'rejected') return 'destructive';
  return 'outline';
}

const PAGE_SIZE = 20;

export default function SuggestionsPage() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [langFilter, setLangFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const availableTypes = getTypesForLanguage(langFilter);

  const { data, error, isLoading, mutate } = useSWR(
    ['suggestions', statusFilter, langFilter, typeFilter, page],
    () =>
      fetchSuggestions({
        status: statusFilter,
        languageCode: langFilter === 'all' ? undefined : langFilter,
        type: typeFilter === 'all' ? undefined : typeFilter,
        page,
      }),
  );

  const startPollingUntilComplete = useCallback(() => {
    setGenerating(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await fetchPipelineStatus();
        setProgress(status.progress ?? null);
        if (!status.running) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setGenerating(false);
          setProgress(null);
          await mutate();
        }
      } catch {
        // ignore poll errors; next tick will retry
      }
    }, 2000);
  }, [mutate]);

  useEffect(() => {
    let cancelled = false;
    fetchPipelineStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.running) {
          setProgress(status.progress ?? null);
          startPollingUntilComplete();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [startPollingUntilComplete]);

  function handleGenerate() {
    setGenerating(true);
    setProgress({ phase: 'Starting', percent: 0, message: 'Starting pipeline…' });
    startPollingUntilComplete();
    // Fetch progress soon so the bar updates (backend sets progress when pipeline starts)
    fetchPipelineStatus()
      .then((s) => setProgress(s.progress ?? null))
      .catch(() => {});
    triggerGeneration()
      .then((result) => {
        toast.success(
          `Pipeline complete: ${result.created} suggestions created, ${result.skipped} skipped.`,
        );
        // Polling will clear generating state and call mutate() when backend sets running: false
      })
      .catch((err) => {
        const is409 = err instanceof Error && err.message.includes('409');
        if (!is409) {
          toast.error('Generation pipeline failed. Check the backend logs.');
          setGenerating(false);
          setProgress(null);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      });
  }

  function handleLangChange(lang: string) {
    setLangFilter(lang);
    setTypeFilter('all');
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suggestions</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              {data.total} suggestion{data.total !== 1 ? 's' : ''} found
            </p>
          )}
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          <Play data-icon="inline-start" className="h-4 w-4" />
          {generating ? 'Generating…' : 'Run pipeline'}
        </Button>
      </div>

      {generating && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-muted-foreground">
              {progress?.phase ?? 'Running pipeline…'}
            </span>
            <span className="tabular-nums font-semibold">{progress?.percent ?? 0}%</span>
          </div>
          <Progress value={progress?.percent ?? 0} className="h-2" />
          {progress?.message && <p className="text-xs text-muted-foreground">{progress.message}</p>}
        </div>
      )}

      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Language</Label>
          <Select value={langFilter} onValueChange={handleLangChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {availableTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2.5 rounded-full border shrink-0 ${t.badgeClassName}`}
                      aria-hidden
                    />
                    {t.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm">
          Failed to load suggestions. Is the backend running?
        </p>
      )}

      {!isLoading && data?.data.length === 0 && (
        <div className="rounded-lg border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
          No suggestions found for the current filters. Try running the pipeline to generate new
          suggestions.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {data?.data.map((s: Suggestion) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-4 rounded-lg border bg-card px-4 py-3 shadow-sm"
          >
            <div className="flex flex-1 flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-base font-semibold">
                  {(s.payload as { englishLabel?: string; lemma?: string }).englishLabel ??
                    (s.payload as { lemma?: string }).lemma ??
                    s.lexemeId}
                </span>
                <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                <Badge variant="outline" className="font-normal text-xs">
                  {s.languageCode.toUpperCase()}
                </Badge>
                <Badge
                  variant="outline"
                  className={`font-normal border ${getSuggestionTypeBadgeClass(s.suggestionType)}`}
                >
                  {suggestionTypeLabel(s.suggestionType)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Proposed:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                    {(s.payload as { finalForm?: string; proposedForm?: string }).finalForm ??
                      (s.payload as { proposedForm?: string }).proposedForm ??
                      '—'}
                  </code>
                </span>
                <span>Confidence: {confidenceLabel(s.llmConfidence)}</span>
                <a
                  href={
                    `https://www.wikidata.org/wiki/Lexeme:${s.lexemeId}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {s.lexemeId} ↗
                </a>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/suggestions/${s.id}`}>Review</Link>
            </Button>
          </div>
        ))}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ← Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
