const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface VerbFormProposal {
  slotId: string;
  label: string;
  grammaticalFeatures: string[];
  proposedForm: string | null;
  finalForm: string | null;
  confidence: number;
  needsLlm: boolean;
}

export interface Suggestion {
  id: string;
  lexemeId: string;
  languageCode: string;
  suggestionType: string;
  payload: {
    lemma?: string;
    proposedForm?: string;
    finalForm?: string;
    ruleId?: string;
    glossNl?: string | null;
    [key: string]: unknown;
  };
  rationale: string | null;
  ruleConfidence: number | null;
  llmConfidence: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionsResponse {
  data: Suggestion[];
  total: number;
}

export interface User {
  id: string;
  username: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const fetcher = (url: string) => apiFetch<unknown>(url);

export function fetchSuggestions(params: {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
  languageCode?: string;
}): Promise<SuggestionsResponse> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  if (params.languageCode) q.set('languageCode', params.languageCode);
  return apiFetch<SuggestionsResponse>(`/api/suggestions?${q.toString()}`);
}

export function fetchSuggestion(id: string): Promise<Suggestion> {
  return apiFetch<Suggestion>(`/api/suggestions/${id}`);
}

export function acceptSuggestion(id: string): Promise<Suggestion> {
  return apiFetch<Suggestion>(`/api/suggestions/${id}/accept`, { method: 'POST', body: '{}' });
}

export function editAndAcceptSuggestion(
  id: string,
  payload: Record<string, unknown>,
): Promise<Suggestion> {
  return apiFetch<Suggestion>(`/api/suggestions/${id}/edit-and-accept`, {
    method: 'POST',
    body: JSON.stringify({ payload }),
  });
}

export function rejectSuggestion(
  id: string,
  reasonCategory: string,
  comment: string,
): Promise<Suggestion> {
  return apiFetch<Suggestion>(`/api/suggestions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({
      reasonCategory: reasonCategory || undefined,
      comment: comment || undefined,
    }),
  });
}

export function fetchMe(): Promise<User | null> {
  return apiFetch<User | null>('/auth/me');
}

export function loginUrl(): string {
  return `${API_BASE}/auth/login`;
}

export function logoutUrl(): string {
  return `${API_BASE}/auth/logout`;
}

export interface PipelineProgress {
  phase: string;
  percent: number;
  message: string;
}

export interface PipelineStatus {
  running: boolean;
  progress: PipelineProgress | null;
}

export function fetchPipelineStatus(): Promise<PipelineStatus> {
  return apiFetch<PipelineStatus>('/api/suggestions/pipeline/status');
}

export function triggerGeneration(): Promise<{ created: number; skipped: number }> {
  return apiFetch(`/api/suggestions/generate`, { method: 'POST', body: '{}' });
}

export function clearSuggestions(status?: string): Promise<{ deleted: number }> {
  const q = status ? `?status=${status}` : '';
  return apiFetch<{ deleted: number }>(`/api/suggestions${q}`, { method: 'DELETE' });
}

export function clearProcessedLexemes(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(`/api/suggestions/processed`, { method: 'DELETE' });
}

export function deduplicatePendingSuggestions(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(`/api/suggestions/deduplicate-pending`, { method: 'POST' });
}

export function applySuggestionForm(id: string, slotId: string, value?: string): Promise<void> {
  return apiFetch<void>(`/api/suggestions/${id}/apply-form`, {
    method: 'POST',
    body: JSON.stringify({ slotId, value: value ?? undefined }),
  });
}

export function revokeSuggestion(id: string): Promise<void> {
  return apiFetch<void>(`/api/suggestions/${id}/revoke`, { method: 'POST', body: '{}' });
}
