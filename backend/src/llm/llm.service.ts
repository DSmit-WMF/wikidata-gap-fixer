import {
  ADJECTIVE_FORMS_SYSTEM,
  NOUN_PLURAL_SYSTEM,
  VERB_FORMS_SYSTEM,
} from './prompts';
import { Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import type { ExistingForm } from '../wikidata/wikidata.service';
import OpenAI from 'openai';

export type LlmDecision = 'ACCEPTABLE' | 'UNSURE' | 'REJECT';

export interface LlmValidationResult {
  decision: LlmDecision;
  finalForm: string;
  glossNl: string | null;
  rationale: string;
  /** 0 when LLM was disabled or failed, otherwise the LLM-reported confidence */
  confidence: number;
}

export interface LlmVerbFormItem {
  slotId: string;
  finalForm: string | null;
  confidence: number;
  rationale: string;
}

export interface LlmVerbFormsResult {
  forms: LlmVerbFormItem[];
  overallRationale: string;
  /** 0 when LLM was disabled or failed, otherwise average of form confidences */
  llmConfidence: number;
}

/** Default options for Responses API: JSON output, low reasoning effort so the model has room for the answer. */
const DEFAULT_RESPONSE_OPTIONS = {
  text: { format: { type: 'json_object' as const } },
  reasoning: { effort: 'low' as const },
};

export interface PreviousRejectionFeedback {
  reasonCategory: string | null;
  comment: string | null;
}

export interface RecentRejectionForType {
  lemma?: string;
  reasonCategory: string | null;
  comment: string | null;
}

function formatRejectionFeedback(f: PreviousRejectionFeedback): string {
  const parts: string[] = [];
  if (f.reasonCategory) parts.push(`Reason: ${f.reasonCategory}`);
  if (f.comment?.trim()) parts.push(`Comment: ${f.comment.trim()}`);
  if (parts.length === 0) return '';
  return `\n\nImportant: A human previously rejected a suggestion for this lexeme. ${parts.join('. ')}. Use this feedback to reject or correct your suggestion.`;
}

function formatRecentRejectionsForType(rejections: RecentRejectionForType[]): string {
  if (rejections.length === 0) return '';
  const lines = rejections
    .filter((r) => r.reasonCategory || r.comment?.trim())
    .map((r) => {
      const parts: string[] = [];
      if (r.lemma) parts.push(`"${r.lemma}"`);
      if (r.reasonCategory) parts.push(`reason: ${r.reasonCategory}`);
      if (r.comment?.trim()) parts.push(r.comment.trim());
      return parts.length > 0 ? `- ${parts.join('; ')}` : '';
    })
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\n\nHumans have previously rejected suggestions for this type. Use these to avoid similar mistakes:\n${lines.join('\n')}`;
}

/** Well-known Q-IDs from lexeme statements (P1552 has characteristic) for noun/verb/adjective context. */
const LEXEME_STATEMENT_LABELS: Record<string, string> = {
  Q604984: 'singulare tantum (only singular; no plural)',
  Q138246: 'plurale tantum (only plural)',
  Q489168: 'mass noun',
  Q11803002: 'defective paradigm (incomplete conjugation/declension)',
  Q55074511: 'reconstructed word',
  Q101244: 'acronym',
};

function formatLexemeContext(
  lexemeStatementIds: string[],
  existingGlosses?: Record<string, string> | null,
): string {
  if (
    lexemeStatementIds.length === 0 &&
    (!existingGlosses || Object.keys(existingGlosses).length === 0)
  )
    return '';
  const parts: string[] = [];
  if (lexemeStatementIds.length > 0) {
    parts.push(
      `Wikidata statements on this lexeme (has characteristic): ${lexemeStatementIds.map((id) => LEXEME_STATEMENT_LABELS[id] ?? id).join('; ')}.`,
    );
  }
  if (existingGlosses && Object.keys(existingGlosses).length > 0) {
    parts.push(`Existing glosses (senses): ${JSON.stringify(existingGlosses)}.`);
  }
  if (parts.length === 0) return '';
  return `\n\n${parts.join(' ')} Use this context to decide whether to suggest forms or set finalForm to null.`;
}

/** Strip leading Dutch pronoun + space from a verb form (e.g. "ik loop" -> "loop"). */
function stripLeadingPronoun(form: string): string {
  const t = form.trim();
  const m = t.match(/^(ik|jij|hij|zij|wij|jullie)\s+/i);
  return m ? t.slice(m[0].length).trim() : t;
}

function safeParseJson<T>(raw: string): T | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('openai.apiKey');
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  get isEnabled(): boolean {
    return this.config.get<boolean>('features.llmEnabled') === true && this.client !== null;
  }

  /**
   * Ask the LLM to propose a Dutch plural form for a noun, purely from
   * lemma + existing Wikidata forms + glosses (no rule-based proposal).
   *
   * The model should return:
   * - decision = ACCEPTABLE with a concrete plural in finalForm when it
   *   is confident the noun is countable and the plural is natural
   * - decision = REJECT or UNSURE (and any finalForm) when the noun is
   *   uncountable or the plural is dubious; the caller will skip those
   */
  async validateNounPluralSuggestion(params: {
    lemma: string;
    existingForms: ExistingForm[];
    existingGlosses: Record<string, string>;
    lexemeStatementIds?: string[];
    previousRejection?: PreviousRejectionFeedback | null;
    recentRejectionsForType?: RecentRejectionForType[];
  }): Promise<LlmValidationResult> {
    if (!this.isEnabled || !this.client) {
      return this.fallbackResult(params.lemma);
    }

    const model = this.config.get<string>('openai.model') ?? 'gpt-5-nano';
    const maxTokens = this.config.get<number>('openai.maxOutputTokens') ?? 1024;

    const formsSummary =
      params.existingForms.length === 0
        ? '  (no forms recorded)'
        : params.existingForms
            .map((f) => {
              const rep = Object.values(f.representations)[0] ?? '';
              const feats =
                f.grammaticalFeatures.length > 0 ? f.grammaticalFeatures.join(', ') : 'no features';
              return `  - "${rep}" [${feats}]`;
            })
            .join('\n');

    const userMessage = `Dutch noun lemma: "${params.lemma}"

Existing forms on Wikidata (any language, with grammatical features):
${formsSummary}

Existing glosses: ${JSON.stringify(params.existingGlosses)}
${(params.lexemeStatementIds ?? []).length > 0 ? `\nWikidata statements on this lexeme (has characteristic): ${(params.lexemeStatementIds ?? []).map((id) => LEXEME_STATEMENT_LABELS[id] ?? id).join('; ')}. If this includes singulare tantum (Q604984) or mass noun, do NOT suggest a plural; set decision to "REJECT" and set finalForm to the lemma.` : ''}

Decide if this noun has a commonly used plural form in Dutch.
- If it is generally uncountable (mass/abstract) or pluralized only in rare/technical contexts, set decision to "REJECT" and explain why; set finalForm to the original lemma.
- If there is a natural, commonly used plural, set decision to "ACCEPTABLE" and give ONLY the correct plural in finalForm (no quotes, no extra text).
- If you are genuinely uncertain, set decision to "UNSURE" and finalForm to the original lemma.${params.previousRejection ? formatRejectionFeedback(params.previousRejection) : ''}${params.recentRejectionsForType?.length ? formatRecentRejectionsForType(params.recentRejectionsForType) : ''}`;

    const systemPrompt = NOUN_PLURAL_SYSTEM;
    console.log('============== NOUN PLURAL SYSTEM PROMPT ==============');
    console.log('\nSYSTEM PROMPT: ', systemPrompt);
    console.log('\nUSER MESSAGE:', userMessage);
    console.log('--------------------------------');
    try {
      const response = await this.client.responses.create({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_output_tokens: maxTokens,
        ...DEFAULT_RESPONSE_OPTIONS,
      });

      console.log('\nRESPONSE:', response.output_text);
      console.log('--------------------------------');
      const raw = response.output_text ?? '';
      const parsed = safeParseJson<Partial<LlmValidationResult>>(raw);
      if (!parsed) {
        const resp = response as { status?: string; incomplete_details?: { reason?: string } };
        const reason =
          resp.status === 'incomplete' && resp.incomplete_details?.reason === 'max_output_tokens'
            ? 'Response truncated (max_output_tokens); using fallback.'
            : 'LLM returned empty or invalid JSON; using fallback.';
        this.logger.warn(reason);
        return this.fallbackResult(params.lemma);
      }

      return {
        decision: parsed.decision ?? 'UNSURE',
        finalForm: parsed.finalForm ?? params.lemma,
        glossNl: parsed.glossNl ?? null,
        rationale: parsed.rationale ?? '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };
    } catch (err) {
      console.log('ERROR:', err);
      this.logger.warn(`LLM call failed: ${(err as Error).message}`);
      return this.fallbackResult(params.lemma);
    }
  }

  /**
   * Ask the LLM to fill in missing Dutch verb forms (primarily for strong verbs).
   */
  async suggestVerbForms(params: {
    infinitive: string;
    verbClass: 'weak' | 'strong' | 'unknown';
    existingForms: Array<{ form: string; featureLabels: string[] }>;
    missingSlots: Array<{
      slotId: string;
      label: string;
      proposedForm: string | null;
    }>;
    lexemeStatementIds?: string[];
    existingGlosses?: Record<string, string> | null;
    previousRejection?: PreviousRejectionFeedback | null;
    recentRejectionsForType?: RecentRejectionForType[];
  }): Promise<LlmVerbFormsResult> {
    if (!this.isEnabled || !this.client) {
      return this.verbFallback(params.missingSlots);
    }

    const model = this.config.get<string>('openai.model') ?? 'gpt-5-nano';
    const maxTokens = this.config.get<number>('openai.maxOutputTokens') ?? 1024;

    const existingLines = params.existingForms.map(
      (f) => `  ${f.form} (${f.featureLabels.join(', ')})`,
    );
    const missingLines = params.missingSlots.map(
      (s) =>
        `  ${s.slotId}: ${s.label}${s.proposedForm ? ` (rule suggests: "${s.proposedForm}")` : ''}`,
    );

    const userMessage = `Dutch verb infinitive: "${params.infinitive}"
Verb class hint: ${params.verbClass}

Known existing forms:
${existingLines.join('\n')}

Missing form slots to fill:
${missingLines.join('\n')}
${formatLexemeContext(params.lexemeStatementIds ?? [], params.existingGlosses)}

Provide the correct Dutch form for each missing slot. Each finalForm must be ONLY the verb (e.g. "loop", "werkte")—no pronouns like ik, jij, hij, wij. For strong verbs with vowel ablaut, use your knowledge of Dutch verb classes. If the lexeme has a defective paradigm or other relevant characteristic, set finalForm to null where appropriate. If genuinely uncertain, set finalForm to null.${params.previousRejection ? formatRejectionFeedback(params.previousRejection) : ''}${params.recentRejectionsForType?.length ? formatRecentRejectionsForType(params.recentRejectionsForType) : ''}`;

    const systemPrompt = VERB_FORMS_SYSTEM;
    console.log('============== VERB FORMS SYSTEM PROMPT ==============');
    console.log('\nSYSTEM PROMPT: ', systemPrompt);
    console.log('\nUSER MESSAGE:', userMessage);
    console.log('--------------------------------');
    try {
      const response = await this.client.responses.create({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_output_tokens: maxTokens,
        ...DEFAULT_RESPONSE_OPTIONS,
      });

      console.log('\nRESPONSE:', response.output_text);
      console.log('--------------------------------');
      const raw = response.output_text ?? '';
      const parsed = safeParseJson<Partial<LlmVerbFormsResult>>(raw);
      if (!parsed) {
        const resp = response as { status?: string; incomplete_details?: { reason?: string } };
        const reason =
          resp.status === 'incomplete' && resp.incomplete_details?.reason === 'max_output_tokens'
            ? 'Verb forms response truncated (max_output_tokens); using fallback.'
            : 'LLM verb forms returned empty or invalid JSON; using fallback.';
        this.logger.warn(reason);
        return this.verbFallback(params.missingSlots);
      }

      let forms =
        parsed.forms ??
        params.missingSlots.map((s) => ({
          slotId: s.slotId,
          finalForm: s.proposedForm,
          confidence: 0.5,
          rationale: 'LLM parse failed; using fallback.',
        }));
      forms = forms.map((f) => ({
        ...f,
        finalForm:
          f.finalForm != null && typeof f.finalForm === 'string'
            ? stripLeadingPronoun(f.finalForm) || f.finalForm
            : f.finalForm,
      }));
      const avgConf =
        forms.length > 0 ? forms.reduce((sum, f) => sum + f.confidence, 0) / forms.length : 0;
      return {
        forms,
        overallRationale: parsed.overallRationale ?? '',
        llmConfidence: avgConf,
      };
    } catch (err) {
      console.log('ERROR:', err);
      this.logger.warn(`LLM verb forms call failed: ${(err as Error).message}`);
      return this.verbFallback(params.missingSlots);
    }
  }

  /**
   * Ask the LLM to fill in missing Dutch adjective comparison forms (comparative, superlative).
   */
  async suggestAdjectiveForms(params: {
    lemma: string;
    missingSlots: Array<{
      slotId: string;
      label: string;
      proposedForm: string | null;
    }>;
    lexemeStatementIds?: string[];
    existingGlosses?: Record<string, string> | null;
    previousRejection?: PreviousRejectionFeedback | null;
    recentRejectionsForType?: RecentRejectionForType[];
  }): Promise<LlmVerbFormsResult> {
    if (!this.isEnabled || !this.client) {
      return this.slotFallback(params.missingSlots);
    }

    const model = this.config.get<string>('openai.model') ?? 'gpt-5-nano';
    const maxTokens = this.config.get<number>('openai.maxOutputTokens') ?? 1024;

    const missingLines = params.missingSlots.map(
      (s) =>
        `  ${s.slotId}: ${s.label}${s.proposedForm ? ` (rule suggests: "${s.proposedForm}")` : ''}`,
    );

    const userMessage = `Dutch adjective: "${params.lemma}"

Missing form slots to fill:
${missingLines.join('\n')}
${formatLexemeContext(params.lexemeStatementIds ?? [], params.existingGlosses)}

Provide the correct Dutch form for each slot. If the adjective is irregular or not gradable (or Wikidata statements indicate so), set finalForm to null.${params.previousRejection ? formatRejectionFeedback(params.previousRejection) : ''}${params.recentRejectionsForType?.length ? formatRecentRejectionsForType(params.recentRejectionsForType) : ''}`;

    const systemPrompt = ADJECTIVE_FORMS_SYSTEM;
    console.log('============== ADJECTIVE FORMS SYSTEM PROMPT ==============');
    console.log('\nSYSTEM PROMPT: ', systemPrompt);
    console.log('\nUSER MESSAGE:', userMessage);
    console.log('--------------------------------');
    try {
      const response = await this.client.responses.create({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_output_tokens: maxTokens,
        ...DEFAULT_RESPONSE_OPTIONS,
      });

      console.log('\nRESPONSE:', response.output_text);
      console.log('--------------------------------');
      const raw = response.output_text ?? '';
      const parsed = safeParseJson<Partial<LlmVerbFormsResult>>(raw);
      if (!parsed) {
        const resp = response as { status?: string; incomplete_details?: { reason?: string } };
        const reason =
          resp.status === 'incomplete' && resp.incomplete_details?.reason === 'max_output_tokens'
            ? 'Adjective forms response truncated (max_output_tokens); using fallback.'
            : 'LLM adjective forms returned empty or invalid JSON; using fallback.';
        this.logger.warn(reason);
        return this.slotFallback(params.missingSlots);
      }

      const forms =
        parsed.forms ??
        params.missingSlots.map((s) => ({
          slotId: s.slotId,
          finalForm: s.proposedForm,
          confidence: 0.5,
          rationale: 'LLM parse failed; using fallback.',
        }));
      const avgConf =
        forms.length > 0 ? forms.reduce((sum, f) => sum + f.confidence, 0) / forms.length : 0;
      return {
        forms,
        overallRationale: parsed.overallRationale ?? '',
        llmConfidence: avgConf,
      };
    } catch (err) {
      console.log('ERROR:', err);
      this.logger.warn(`LLM adjective forms call failed: ${(err as Error).message}`);
      return this.slotFallback(params.missingSlots);
    }
  }

  // (Item-label suggestion code removed)

  private slotFallback(
    missingSlots: Array<{ slotId: string; proposedForm: string | null }>,
  ): LlmVerbFormsResult {
    return {
      forms: missingSlots.map((s) => ({
        slotId: s.slotId,
        finalForm: s.proposedForm,
        confidence: 0.5,
        rationale: 'LLM disabled or unavailable; fallback proposal used.',
      })),
      overallRationale: 'LLM unavailable; using fallback proposals.',
      llmConfidence: 0,
    };
  }

  private verbFallback(
    missingSlots: Array<{ slotId: string; proposedForm: string | null }>,
  ): LlmVerbFormsResult {
    return this.slotFallback(missingSlots);
  }

  private fallbackResult(form: string): LlmValidationResult {
    return {
      decision: 'UNSURE',
      finalForm: form,
      glossNl: null,
      rationale: 'LLM disabled or unavailable; fallback result used.',
      confidence: 0,
    };
  }
}
