'use client';

import { useParams, useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  acceptSuggestion,
  editAndAcceptSuggestion,
  fetchSuggestion,
  rejectSuggestion,
  applySuggestionForm,
  revokeSuggestion,
  type Suggestion,
  type VerbFormProposal,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSuggestionTypeBadgeClass } from '@/lib/suggestion-types';
import { suggestionTypeLabel } from '@/lib/utils';
import { getFeatureLabel, getFeatureUrl } from '@/lib/wikidata-grammatical-features';

const REASON_CATEGORIES = [
  { value: 'wrong_form', label: 'Wrong form' },
  { value: 'wrong_meaning', label: 'Wrong meaning' },
  { value: 'ambiguous', label: 'Ambiguous' },
  { value: 'other', label: 'Other' },
];

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'success' | 'destructive' | 'outline' {
  if (status === 'pending') return 'default';
  if (status === 'applied') return 'success';
  if (status === 'rejected') return 'destructive';
  return 'outline';
}

function ConfidenceBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export default function SuggestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const {
    data: suggestion,
    error,
    isLoading,
    mutate,
  } = useSWR<Suggestion>(id ? `suggestion-${id}` : null, () => fetchSuggestion(id));

  const [editedForm, setEditedForm] = useState<string | null>(null);
  const [editedGloss, setEditedGloss] = useState<string | null>(null);
  const [editedVerbForms, setEditedVerbForms] = useState<Record<string, string>>({});
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('wrong_form');
  const [rejectComment, setRejectComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [applyingSlotId, setApplyingSlotId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !suggestion) {
    return <p className="text-destructive text-sm">Suggestion not found.</p>;
  }

  const lemma = suggestion.payload.lemma as string | undefined;
  const finalForm = suggestion.payload.finalForm as string | undefined;
  const proposedForm = suggestion.payload.proposedForm as string | undefined;
  const glossNl = suggestion.payload.glossNl as string | null | undefined;
  const ruleId = suggestion.payload.ruleId as string | undefined;
  const isVerbForms = suggestion.suggestionType === 'NL_VERB_FORMS';
  const isFormsSuggestion =
    suggestion.suggestionType === 'NL_VERB_FORMS' ||
    suggestion.suggestionType === 'NL_ADJECTIVE_FORMS';
  const isNounPluralSuggestion = suggestion.suggestionType === 'NL_NOUN_PLURAL_FORM';
  const lexemeHasNoSenses = suggestion.payload.lexemeHasNoSenses as boolean | undefined;
  const forms = suggestion.payload.forms as VerbFormProposal[] | undefined;
  const verbClass = suggestion.payload.verbClass as string | undefined;
  const appliedFormSlotIds =
    (suggestion.payload as { appliedFormSlotIds?: string[] }).appliedFormSlotIds ?? [];

  const displayLabel = lemma ?? suggestion.lexemeId;
  const currentForm =
    editedForm !== null ? editedForm : (finalForm ?? proposedForm ?? '');
  const currentGloss = editedGloss !== null ? editedGloss : (glossNl ?? '');

  function getVerbFormValue(form: VerbFormProposal): string {
    return editedVerbForms[form.slotId] ?? form.finalForm ?? form.proposedForm ?? '';
  }

  async function handleAccept() {
    setSubmitting(true);
    try {
      if (isFormsSuggestion && forms && suggestion) {
        const updatedForms = forms.map((f) => ({
          ...f,
          finalForm: getVerbFormValue(f) || null,
        }));
        await editAndAcceptSuggestion(id, {
          ...suggestion.payload,
          forms: updatedForms,
        });
      } else if (suggestion) {
        const hasEdits = editedForm !== null || editedGloss !== null;
        if (hasEdits) {
          await editAndAcceptSuggestion(id, {
            ...suggestion.payload,
            finalForm: currentForm,
            glossNl: lexemeHasNoSenses ? currentGloss || null : null,
          });
        } else {
          await acceptSuggestion(id);
        }
      }
      toast.success('Suggestion accepted and applied to Wikidata.');
      await mutate();
      setTimeout(() => router.push('/suggestions'), 1200);
    } catch {
      toast.error('Failed to apply the suggestion. Check your Wikidata login.');
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setSubmitting(true);
    try {
      await rejectSuggestion(id, rejectReason, rejectComment);
      setShowRejectDialog(false);
      toast.success('Suggestion rejected.');
      await mutate();
      setTimeout(() => router.push('/suggestions'), 1200);
    } catch {
      toast.error('Failed to reject suggestion.');
      setSubmitting(false);
    }
  }

  const hasNounEdits = editedForm !== null || editedGloss !== null;
  const showEditLabel = hasNounEdits;

  async function handleApplyForm(slotId: string) {
    if (!forms) return;
    const form = forms.find((f) => f.slotId === slotId);
    const valueToApply = form ? getVerbFormValue(form) : '';
    setApplyingSlotId(slotId);
    try {
      await applySuggestionForm(id, slotId, valueToApply || undefined);
      toast.success('Form applied to Wikidata.');
      await mutate();
    } catch (err) {
      console.error(err);
      toast.error('Failed to apply this form. Check your Wikidata login.');
    } finally {
      setApplyingSlotId((current) => (current === slotId ? null : current));
    }
  }

  async function handleRevoke() {
    if (!id) return;
    setRevoking(true);
    try {
      await revokeSuggestion(id);
      toast.success(
        'Suggestion revoked. The pipeline will pick this lexeme up again on the next run.',
      );
      router.push('/suggestions');
    } catch {
      toast.error('Failed to revoke suggestion.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/suggestions" className="hover:text-foreground transition-colors">
          ← Suggestions
        </Link>
        <span>/</span>
        <span className="text-foreground font-mono">{displayLabel ?? id}</span>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-mono text-xl font-bold truncate">
              {displayLabel ?? suggestion.lexemeId}
            </h1>
            <Badge variant={statusVariant(suggestion.status)}>{suggestion.status}</Badge>
            {isVerbForms && verbClass && <Badge variant="outline">{verbClass} verb</Badge>}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevoke}
            disabled={submitting || revoking}
            className="shrink-0"
          >
            {revoking ? 'Revoking…' : 'Revoke & retry'}
          </Button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Lexeme</p>
              <a
                href={
                  `https://www.wikidata.org/wiki/Lexeme:${suggestion.lexemeId}`
                }
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {suggestion.lexemeId} ↗
              </a>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Type</p>
              <Badge
                variant="outline"
                className={`font-normal border ${getSuggestionTypeBadgeClass(suggestion.suggestionType)}`}
              >
                {suggestionTypeLabel(suggestion.suggestionType)}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                Language
              </p>
              {suggestion.languageCode}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Rule</p>
              {ruleId ?? '—'}
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
              Proposed change
            </p>
            {isFormsSuggestion && forms ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Proposed</TableHead>
                    <TableHead>Wikidata features</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forms.map((form) => (
                    <TableRow key={form.slotId}>
                      <TableCell className="text-muted-foreground text-sm">{form.label}</TableCell>
                      <TableCell>
                        <Input
                          value={getVerbFormValue(form)}
                          onChange={(e) =>
                            setEditedVerbForms((prev) => ({
                              ...prev,
                              [form.slotId]: e.target.value,
                            }))
                          }
                          className="h-8 max-w-48 font-mono text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                          placeholder="—"
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground">
                          {(form.grammaticalFeatures ?? []).map((qid, i) => (
                            <Fragment key={qid}>
                              {i > 0 ? ', ' : null}
                              <a
                                href={getFeatureUrl(qid)}
                                target="_blank"
                                rel="noreferrer"
                                title={qid}
                                className="hover:text-foreground hover:underline"
                              >
                                {getFeatureLabel(qid)}
                              </a>
                            </Fragment>
                          ))}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {form.needsLlm ? 'LLM' : 'rule'} · {Math.round(form.confidence * 100)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {appliedFormSlotIds.includes(form.slotId) ? (
                          <span className="text-xs text-muted-foreground">Applied</span>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={
                              suggestion.status !== 'pending' || applyingSlotId === form.slotId
                            }
                            onClick={() => handleApplyForm(form.slotId)}
                          >
                            {applyingSlotId === form.slotId ? 'Applying…' : 'Apply form'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground line-through">— (missing form)</span>
                <span className="text-muted-foreground">→</span>
                <code className="rounded bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-2 py-0.5 text-green-700 dark:text-green-400 font-semibold">
                  {finalForm ?? proposedForm}
                </code>
              </div>
            )}
          </div>

          {suggestion.rationale && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Rationale
              </p>
              <p className="text-sm text-muted-foreground">{suggestion.rationale}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <ConfidenceBar label="LLM confidence" value={suggestion.llmConfidence} />
          </div>

          {suggestion.status === 'pending' && (
            <>
              <Separator />

              {!isFormsSuggestion && (
                <div>
                  <p className="text-sm font-medium mb-3">Edit before accepting (optional)</p>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Form to add</Label>
                      <Input
                        value={currentForm}
                        onChange={(e) => setEditedForm(e.target.value)}
                        className="max-w-64 font-mono"
                      />
                    </div>
                    {isNounPluralSuggestion && lexemeHasNoSenses && (
                      <div className="flex flex-col gap-1.5">
                        <Label>Dutch sense (optional)</Label>
                        <Input
                          value={currentGloss}
                          onChange={(e) => setEditedGloss(e.target.value)}
                          placeholder="e.g. meervoud van het zelfstandig naamwoord…"
                          className="max-w-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={handleAccept}
                  disabled={
                    submitting ||
                    (!isFormsSuggestion && !currentForm)
                  }
                >
                  {!isFormsSuggestion && showEditLabel ? 'Edit & Accept' : 'Accept'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={submitting}
                >
                  Reject
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject suggestion</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>Reason</Label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Comment (optional)</Label>
              <Textarea
                rows={3}
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Additional feedback to improve the system…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={submitting}>
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
