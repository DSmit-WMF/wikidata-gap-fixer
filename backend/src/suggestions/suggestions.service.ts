import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Suggestion,
  SuggestionStatus,
  SuggestionType,
} from '../database/entities/suggestion.entity';
import {
  ActionType,
  ReasonCategory,
  SuggestionAction,
} from '../database/entities/suggestion-action.entity';
import { LlmService } from '../llm/llm.service';
import { GRAMMATICAL_FEATURES } from '../rules/nl/noun';
import { findMissingVerbForms } from '../rules/nl/verb';
import { getExpectedFormsSpec } from '../rules/nl/expected-forms';
import { detectGaps } from '../rules/gap-detector';
import { VerbFormProposal } from '../database/entities/suggestion.entity';
import { ProcessedLexeme, ProcessedOutcome } from '../database/entities/processed-lexeme.entity';
import { User } from '../database/entities/user.entity';
import { WikidataService } from '../wikidata/wikidata.service';
import { NL_CATEGORY } from '../rules/nl/expected-forms';

const TOTAL_PIPELINE_PHASES = 3; // noun, verb, adjective

export interface PipelineProgress {
  phase: string;
  percent: number;
  message: string;
}

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);
  private pipelineRunning = false;
  private pipelineProgress: PipelineProgress | null = null;

  constructor(
    @InjectRepository(Suggestion)
    private readonly suggestionRepo: Repository<Suggestion>,
    @InjectRepository(SuggestionAction)
    private readonly actionRepo: Repository<SuggestionAction>,
    @InjectRepository(ProcessedLexeme)
    private readonly processedLexemeRepo: Repository<ProcessedLexeme>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly wikidataService: WikidataService,
    private readonly llmService: LlmService,
    private readonly config: ConfigService,
  ) {}

  private async markLexemeProcessed(
    lexemeId: string,
    suggestionType: SuggestionType,
    outcome: ProcessedOutcome,
  ): Promise<void> {
    const existing = await this.processedLexemeRepo.findOne({
      where: { lexemeId, suggestionType },
    });

    if (existing) {
      existing.lastDecision = outcome;
      await this.processedLexemeRepo.save(existing);
      return;
    }

    const record = this.processedLexemeRepo.create({
      lexemeId,
      suggestionType,
      lastDecision: outcome,
      lastRevisionId: null,
    });
    await this.processedLexemeRepo.save(record);
  }

  /**
   * Delete suggestions, optionally filtered by status, and also remove their
   * processed-lexeme markers so those lexemes can be re-scanned on the next
   * pipeline run.
   *
   * Passing no status clears everything.
   */
  async clearAll(status?: SuggestionStatus): Promise<{ deleted: number }> {
    const suggestions = await this.suggestionRepo.find({
      where: status ? { status } : {},
      select: ['id', 'lexemeId', 'suggestionType'],
    });

    if (suggestions.length === 0) {
      return { deleted: 0 };
    }

    const ids = suggestions.map((s) => s.id);
    const processedKeys = suggestions.map((s) => ({
      lexemeId: s.lexemeId,
      suggestionType: s.suggestionType,
    }));

    await this.suggestionRepo.delete(ids);
    await this.processedLexemeRepo.delete(processedKeys);

    return { deleted: suggestions.length };
  }

  /**
   * Remove duplicate pending suggestions, keeping one per (lexemeId, suggestionType).
   * Use this to clean up before the unique index on pending suggestions is enforced.
   */
  async removeDuplicatePendingSuggestions(): Promise<{ deleted: number }> {
    const pending = await this.suggestionRepo.find({
      where: { status: 'pending' },
      select: ['id', 'lexemeId', 'suggestionType', 'createdAt'],
      order: { createdAt: 'ASC' },
    });
    const byKey = new Map<string, string>();
    const idsToDelete: string[] = [];
    for (const s of pending) {
      const key = `${s.lexemeId}\t${s.suggestionType}`;
      if (byKey.has(key)) {
        idsToDelete.push(s.id);
      } else {
        byKey.set(key, s.id);
      }
    }
    if (idsToDelete.length === 0) {
      return { deleted: 0 };
    }
    await this.suggestionRepo.delete(idsToDelete);
    this.logger.log(`Removed ${idsToDelete.length} duplicate pending suggestion(s).`);
    return { deleted: idsToDelete.length };
  }

  /**
   * Remove a single suggestion and its processed-lexeme marker so the pipeline
   * will pick this lexeme up again on the next run.
   */
  async revokeSuggestion(id: string): Promise<void> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id },
      select: ['id', 'lexemeId', 'suggestionType'],
    });
    if (!suggestion) {
      throw new NotFoundException(`Suggestion ${id} not found`);
    }
    await this.suggestionRepo.delete(suggestion.id);
    await this.processedLexemeRepo.delete({
      lexemeId: suggestion.lexemeId,
      suggestionType: suggestion.suggestionType,
    });
  }

  async findAll(filters: {
    status?: SuggestionStatus;
    suggestionType?: SuggestionType;
    languageCode?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Suggestion[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const qb = this.suggestionRepo
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.status) qb.andWhere('s.status = :status', { status: filters.status });
    if (filters.suggestionType)
      qb.andWhere('s.suggestionType = :type', { type: filters.suggestionType });
    if (filters.languageCode) qb.andWhere('s.languageCode = :lang', { lang: filters.languageCode });

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<Suggestion> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id },
      relations: ['actions', 'actions.user'],
    });
    if (!suggestion) throw new NotFoundException(`Suggestion ${id} not found`);
    // Backfill appliedFormSlotIds from suggestion_actions for verb/adjective forms (so previously applied forms show "Applied")
    if (
      (suggestion.suggestionType === 'NL_VERB_FORMS' ||
        suggestion.suggestionType === 'NL_ADJECTIVE_FORMS') &&
      suggestion.actions?.length
    ) {
      const fromActions = suggestion.actions
        .filter((a) => a.action === 'applied_form' && a.comment?.startsWith('slotId='))
        .map((a) => a.comment!.replace(/^slotId=/, '').trim())
        .filter(Boolean);
      const existing = (suggestion.payload.appliedFormSlotIds as string[] | undefined) ?? [];
      const merged = [...new Set([...existing, ...fromActions])];
      if (merged.length > 0) {
        suggestion.payload = { ...suggestion.payload, appliedFormSlotIds: merged };
      }
    }
    return suggestion;
  }

  async accept(
    id: string,
    accessToken: string | null,
    editedPayload?: Record<string, unknown>,
    usernameForLog?: string | null,
  ): Promise<Suggestion> {
    const suggestion = await this.findOne(id);
    if (suggestion.status !== 'pending') {
      throw new Error(`Suggestion is not pending (status: ${suggestion.status})`);
    }

    const payload = editedPayload ?? suggestion.payload;
    const actionType: ActionType = editedPayload ? 'edited_accepted' : 'accepted';

    // Apply to Wikidata if the user has a token
    try {
      suggestion.status = 'accepted';
      await this.suggestionRepo.save(suggestion);

      if (accessToken) {
        await this.applyToWikidata(suggestion, payload, accessToken);
        suggestion.status = 'applied';
        await this.suggestionRepo.save(suggestion);
      }
    } catch (err) {
      this.logger.error(`Failed to apply suggestion ${id}: ${(err as Error).message}`);
      suggestion.status = 'failed';
      await this.suggestionRepo.save(suggestion);
    }

    await this.logAction(suggestion.id, usernameForLog ?? null, actionType, null, null);
    return suggestion;
  }

  async reject(
    id: string,
    userId: string | null,
    reasonCategory: ReasonCategory | null,
    comment: string | null,
  ): Promise<Suggestion> {
    console.log('[reject] service', { id, userId, reasonCategory, comment });
    const suggestion = await this.findOne(id);
    if (suggestion.status !== 'pending') {
      throw new Error(`Suggestion is not pending (status: ${suggestion.status})`);
    }

    suggestion.status = 'rejected';
    await this.suggestionRepo.save(suggestion);
    console.log('[reject] suggestion saved as rejected, calling logAction');
    await this.logAction(suggestion.id, userId, 'rejected', reasonCategory, comment);
    console.log('[reject] logAction completed');
    return suggestion;
  }

  /**
   * Apply a single verb/adjective form from a forms suggestion to Wikidata,
   * without accepting the entire suggestion.
   */
  async applySingleForm(
    id: string,
    accessToken: string | null,
    slotId: string,
    usernameForLog?: string | null,
    editedValue?: string | null,
  ): Promise<void> {
    if (!accessToken) {
      throw new Error('User is not logged in with Wikidata.');
    }

    // Load without relations so save(suggestion) later does not sync actions and overwrite suggestionId
    const suggestion = await this.suggestionRepo.findOne({ where: { id } });
    if (!suggestion) throw new NotFoundException(`Suggestion ${id} not found`);

    if (
      suggestion.suggestionType !== 'NL_VERB_FORMS' &&
      suggestion.suggestionType !== 'NL_ADJECTIVE_FORMS'
    ) {
      throw new Error(
        `Per-form apply is only supported for verb/adjective forms suggestions (got ${suggestion.suggestionType}).`,
      );
    }

    const forms = suggestion.payload.forms as VerbFormProposal[] | undefined;
    if (!forms || forms.length === 0) {
      throw new Error('Suggestion has no forms to apply.');
    }

    const form = forms.find((f) => f.slotId === slotId);
    if (!form) {
      throw new Error(`Form slot ${slotId} not found on suggestion.`);
    }

    const appliedSlotIds = (suggestion.payload.appliedFormSlotIds as string[] | undefined) ?? [];
    if (appliedSlotIds.includes(slotId)) {
      throw new Error(`Form "${form.label}" (${slotId}) has already been applied to Wikidata.`);
    }

    const value =
      (editedValue != null && editedValue.trim() !== '' ? editedValue.trim() : null) ??
      form.finalForm ??
      form.proposedForm;
    if (!value) {
      throw new Error(`Form slot ${slotId} has no value to apply.`);
    }

    const editSummary = `Add Dutch ${
      suggestion.suggestionType === 'NL_VERB_FORMS' ? 'verb' : 'adjective'
    } form (${form.label}) via Wikidata Gap Fixer (slot: ${form.slotId}, manually reviewed, per-form apply)`;

    await this.wikidataService.addLexemeForm(
      suggestion.lexemeId,
      { [suggestion.languageCode]: value },
      form.grammaticalFeatures,
      editSummary,
      accessToken,
    );

    await this.logAction(
      suggestion.id,
      usernameForLog ?? null,
      'applied_form',
      null,
      `slotId=${slotId}`,
    );

    const updatedForms = forms.map((f) =>
      f.slotId === slotId ? { ...f, finalForm: value, proposedForm: value } : f,
    );
    suggestion.payload = {
      ...suggestion.payload,
      forms: updatedForms,
      appliedFormSlotIds: [...appliedSlotIds, slotId],
    };
    await this.suggestionRepo.save(suggestion);
  }

  private async applyToWikidata(
    suggestion: Suggestion,
    payload: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const { lexemeId, languageCode } = suggestion;

    if (suggestion.suggestionType === 'NL_NOUN_PLURAL_FORM') {
      const proposedForm = payload.finalForm as string | undefined;
      if (!proposedForm) return;

      const editSummary = `Add Dutch plural form via Wikidata Gap Fixer (rule: ${
        (payload.ruleId as string | undefined) ?? suggestion.suggestionType
      }, manually reviewed)`;

      await this.wikidataService.addLexemeForm(
        lexemeId,
        { [languageCode]: proposedForm },
        [GRAMMATICAL_FEATURES.plural],
        editSummary,
        userId,
      );

      // Only add a sense when the lexeme has no senses at all; otherwise we risk duplicate senses
      const glossNl = payload.glossNl as string | undefined;
      if (glossNl?.trim()) {
        const { senses } = await this.wikidataService.fetchLexemeDetails(lexemeId);
        if (senses.length === 0) {
          await this.wikidataService.addLexemeSense(
            lexemeId,
            { [languageCode]: glossNl.trim() },
            'Add Dutch sense/gloss via Wikidata Gap Fixer (from plural suggestion)',
            userId,
          );
        }
      }
    }

    if (suggestion.suggestionType === 'NL_VERB_FORMS') {
      const forms = payload.forms as VerbFormProposal[] | undefined;
      if (!forms) return;

      for (const form of forms) {
        if (!form.finalForm) continue;

        const editSummary = `Add Dutch verb form (${form.label}) via Wikidata Gap Fixer (slot: ${form.slotId}, manually reviewed)`;

        await this.wikidataService.addLexemeForm(
          lexemeId,
          { [languageCode]: form.finalForm },
          form.grammaticalFeatures,
          editSummary,
          userId,
        );
      }
    }

    if (suggestion.suggestionType === 'NL_ADJECTIVE_FORMS') {
      const forms = payload.forms as VerbFormProposal[] | undefined;
      if (!forms) return;

      for (const form of forms) {
        if (!form.finalForm) continue;

        const editSummary = `Add Dutch adjective form (${form.label}) via Wikidata Gap Fixer (slot: ${form.slotId}, manually reviewed)`;

        await this.wikidataService.addLexemeForm(
          lexemeId,
          { [languageCode]: form.finalForm },
          form.grammaticalFeatures,
          editSummary,
          userId,
        );
      }
    }

    // (Item-label suggestion code removed)
  }

  /**
   * Resolve session identifier (username or user id) to a users.id for FK.
   * Finds or creates a User so that suggestion_actions.userId is valid.
   */
  private async resolveUserId(usernameOrId: string): Promise<string> {
    let user = await this.userRepo.findOne({ where: { id: usernameOrId } });
    if (user) return user.id;
    user = await this.userRepo.findOne({ where: { username: usernameOrId } });
    if (user) return user.id;
    user = this.userRepo.create({ id: usernameOrId, username: usernameOrId });
    await this.userRepo.save(user);
    return user.id;
  }

  private async logAction(
    suggestionId: string,
    usernameOrId: string | null,
    action: ActionType,
    reasonCategory: ReasonCategory | null,
    comment: string | null,
  ): Promise<void> {
    console.log('[logAction] entry', {
      suggestionId,
      usernameOrId,
      action,
      reasonCategory,
      comment,
    });
    const userId = usernameOrId ? await this.resolveUserId(usernameOrId) : null;
    console.log('[logAction] resolved userId', userId);
    const a = this.actionRepo.create({
      suggestionId,
      userId,
      action,
      reasonCategory,
      comment,
    });
    await this.actionRepo.save(a);
    console.log('[logAction] action saved to suggestion_actions', a.id);
  }

  /**
   * Get the most recent rejection feedback for this lexeme + suggestion type (if any).
   * Used when the same lexeme is re-scanned (e.g. after Revoke & retry).
   */
  async getLastRejectionFeedback(
    lexemeId: string,
    suggestionType: SuggestionType,
  ): Promise<{ reasonCategory: string | null; comment: string | null } | null> {
    const action = await this.actionRepo
      .createQueryBuilder('a')
      .innerJoin(Suggestion, 's', 's.id = a.suggestionId')
      .where('s.lexemeId = :lexemeId', { lexemeId })
      .andWhere('s.suggestionType = :suggestionType', { suggestionType })
      .andWhere('a.action = :action', { action: 'rejected' })
      .orderBy('a.createdAt', 'DESC')
      .limit(1)
      .select(['a.reasonCategory', 'a.comment'])
      .getOne();
    if (!action) return null;
    return {
      reasonCategory: action.reasonCategory,
      comment: action.comment,
    };
  }

  /**
   * Get recent rejection feedback for this suggestion type (any lexeme).
   * Used so the LLM can learn from past human rejections when processing similar lexemes.
   * Returns reasonCategory and comment from suggestion_actions so the LLM gets "wrong form" etc.
   */
  async getRejectionFeedbackForType(
    suggestionType: SuggestionType,
    limit = 10,
  ): Promise<Array<{ lemma?: string; reasonCategory: string | null; comment: string | null }>> {
    const actions = await this.actionRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.suggestion', 's')
      .where('s.suggestionType = :suggestionType', { suggestionType })
      .andWhere('a.action = :action', { action: 'rejected' })
      .orderBy('a.createdAt', 'DESC')
      .take(limit)
      .getMany();
    return actions.map((a) => {
      const payload = a.suggestion?.payload as
        | { lemma?: string; englishLabel?: string }
        | null
        | undefined;
      const lemma =
        typeof payload?.lemma === 'string'
          ? payload.lemma
          : typeof payload?.englishLabel === 'string'
            ? payload.englishLabel
            : undefined;
      return {
        lemma,
        reasonCategory: a.reasonCategory ?? null,
        comment: a.comment ?? null,
      };
    });
  }

  /**
   * Scheduled job: run the generation pipeline every 30 minutes automatically.
   */
  // @Cron(CronExpression.EVERY_30_MINUTES)
  // async scheduledPipeline(): Promise<void> {
  //   this.logger.log('Scheduled pipeline triggered (every 30 min)');
  //   const result = await this.runGenerationPipeline();
  //   this.logger.log(
  //     `Scheduled pipeline complete: ${result.created} created, ${result.skipped} skipped.`,
  //   );
  // }

  getPipelineStatus(): { running: boolean; progress: PipelineProgress | null } {
    return { running: this.pipelineRunning, progress: this.pipelineProgress };
  }

  private setProgress(
    phase: string,
    phaseIndex: number,
    currentInPhase: number,
    totalInPhase: number,
  ): void {
    const totalPhases = TOTAL_PIPELINE_PHASES;
    const safeTotal = Math.max(1, totalInPhase);
    const percent = Math.round(((phaseIndex + currentInPhase / safeTotal) / totalPhases) * 100);
    this.pipelineProgress = {
      phase,
      percent: Math.min(100, percent),
      message: `${phase} (${currentInPhase}/${totalInPhase})`,
    };
  }

  /**
   * Run the full suggestion generation pipeline: SPARQL → rules → LLM → DB.
   * Can be triggered manually via the API or by the scheduled job.
   */
  async runGenerationPipeline(): Promise<{ created: number; skipped: number }> {
    const features = this.config.get<Record<string, boolean>>('features.suggestionTypes')!;
    const maxBatch = this.config.get<number>('rules.maxSuggestionsPerBatch') ?? 200;
    const testLimit = this.config.get<number | null>('rules.pipelineTestLimit');

    const limit = testLimit !== null ? testLimit : maxBatch;
    console.log('[pipeline] limit per type:', limit, testLimit !== null ? '(test mode)' : '');
    if (testLimit !== null) {
      this.logger.log(`Pipeline test mode: processing up to ${limit} candidate(s) per type.`);
    }
    const minConf = this.config.get<number>('rules.minRuleConfidence') ?? 0.7;

    this.pipelineRunning = true;
    this.pipelineProgress = {
      phase: 'Preparing',
      percent: 0,
      message: 'Loading processed state…',
    };
    let created = 0;
    let skipped = 0;

    try {
      // Track which lexemes have already been processed for each suggestion type
      // so we don't waste Wikidata/API/LLM calls on them again. This is backed
      // by the persistent processed_lexemes table and survives restarts.
      const processed = await this.processedLexemeRepo.find({
        select: ['lexemeId', 'suggestionType'],
      });
      const seenByType: Partial<Record<SuggestionType, Set<string>>> = {};
      for (const row of processed) {
        if (!seenByType[row.suggestionType]) {
          seenByType[row.suggestionType] = new Set<string>();
        }
        seenByType[row.suggestionType]!.add(row.lexemeId);
      }
      console.log('[pipeline] processed_lexemes by type:', {
        NL_NOUN_PLURAL_FORM: seenByType['NL_NOUN_PLURAL_FORM']?.size ?? 0,
        NL_VERB_FORMS: seenByType['NL_VERB_FORMS']?.size ?? 0,
        NL_ADJECTIVE_FORMS: seenByType['NL_ADJECTIVE_FORMS']?.size ?? 0,
      });

      if (features['NL_NOUN_PLURAL_FORM']) {
        this.logger.log('Running NL_NOUN_PLURAL_FORM pipeline (LLM-only)...');

        const nounRejectionsForType = await this.getRejectionFeedbackForType(
          'NL_NOUN_PLURAL_FORM',
          10,
        );
        const nounSpec = getExpectedFormsSpec('nl', NL_CATEGORY.noun)!;
        const candidates = await this.wikidataService.findDutchNounsMissingPlural(
          limit,
          seenByType['NL_NOUN_PLURAL_FORM'],
        );
        console.log('[pipeline] NL_NOUN_PLURAL_FORM candidates:', candidates.length);
        if (candidates.length === 0) {
          this.logger.log(
            `NL_NOUN_PLURAL_FORM: 0 candidates (${seenByType['NL_NOUN_PLURAL_FORM']?.size ?? 0} already processed). Clear processed state in Danger Zone to re-scan.`,
          );
        }
        const phaseIndex = 0;
        const totalInPhase = Math.max(candidates.length, 1);
        this.setProgress('Noun plurals', phaseIndex, 0, totalInPhase);
        let phaseCreated = 0;
        let phaseSkipped = 0;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          this.setProgress('Noun plurals', phaseIndex, i + 1, totalInPhase);
          // Skip if we already have a pending suggestion for this lexeme
          const existing = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_NOUN_PLURAL_FORM',
              status: 'pending',
            },
          });
          if (existing) {
            phaseSkipped++;
            skipped++;
            continue;
          }

          // Skip if plural slot is already filled (e.g. form "leeuwen" exists but has no grammatical features)
          const gaps = detectGaps(nounSpec, candidate.lemma, candidate.existingForms);
          const hasPluralGap = gaps.some((g) => g.slot.slotId === 'plural');
          if (!hasPluralGap) {
            await this.markLexemeProcessed(
              candidate.lexemeId,
              'NL_NOUN_PLURAL_FORM',
              'no_gap',
            );
            phaseSkipped++;
            skipped++;
            continue;
          }

          // Skip if Wikidata already states singulare tantum (no plural).
          const statementIds = candidate.lexemeStatementIds ?? [];
          if (statementIds.includes('Q604984')) {
            await this.markLexemeProcessed(
              candidate.lexemeId,
              'NL_NOUN_PLURAL_FORM',
              'uncountable',
            );
            phaseSkipped++;
            skipped++;
            continue;
          }

          const existingGlosses: Record<string, string> = {};
          for (const sense of candidate.senses) {
            Object.assign(existingGlosses, sense.glosses);
          }

          const previousRejection = await this.getLastRejectionFeedback(
            candidate.lexemeId,
            'NL_NOUN_PLURAL_FORM',
          );
          const llmResult = await this.llmService.validateNounPluralSuggestion({
            lemma: candidate.lemma,
            existingForms: candidate.existingForms,
            existingGlosses,
            lexemeStatementIds: candidate.lexemeStatementIds ?? [],
            previousRejection: previousRejection ?? undefined,
            recentRejectionsForType:
              nounRejectionsForType.length > 0 ? nounRejectionsForType : undefined,
          });

          // Only keep high-confidence ACCEPTABLE suggestions with a concrete plural
          if (
            llmResult.decision !== 'ACCEPTABLE' ||
            !llmResult.finalForm ||
            llmResult.confidence < minConf
          ) {
            // Record that we inspected this lexeme for this pipeline type but did
            // not create a suggestion (e.g. uncountable or low confidence).
            await this.markLexemeProcessed(
              candidate.lexemeId,
              'NL_NOUN_PLURAL_FORM',
              llmResult.decision === 'REJECT' ? 'uncountable' : 'no_gap',
            );
            phaseSkipped++;
            skipped++;
            continue;
          }

          const lexemeHasNoSenses = candidate.senses.length === 0;
          const suggestion = this.suggestionRepo.create({
            lexemeId: candidate.lexemeId,
            languageCode: 'nl',
            suggestionType: 'NL_NOUN_PLURAL_FORM',
            payload: {
              lemma: candidate.lemma,
              proposedForm: llmResult.finalForm,
              finalForm: llmResult.finalForm,
              glossNl: llmResult.glossNl,
              /** True when the lexeme had no senses at suggestion time; only then do we allow adding a sense to avoid duplicates. */
              lexemeHasNoSenses,
            },
            rationale: `LLM: ${llmResult.rationale}`,
            ruleConfidence: null,
            llmConfidence: llmResult.confidence,
            status: 'pending',
          });

          const duplicate = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_NOUN_PLURAL_FORM',
              status: 'pending',
            },
          });
          if (duplicate) {
            phaseSkipped++;
            skipped++;
            continue;
          }
          await this.suggestionRepo.save(suggestion);
          await this.markLexemeProcessed(
            candidate.lexemeId,
            'NL_NOUN_PLURAL_FORM',
            'suggestion_created',
          );
          phaseCreated++;
          created++;
          console.log('[pipeline] created NL_NOUN_PLURAL_FORM', candidate.lexemeId, candidate.lemma);
        }
        console.log('[pipeline] NL_NOUN_PLURAL_FORM phase done', {
          created: phaseCreated,
          skipped: phaseSkipped,
        });
      }

      if (features['NL_VERB_FORMS']) {
        this.logger.log('Running NL_VERB_FORMS pipeline...');

        const verbRejectionsForType = await this.getRejectionFeedbackForType('NL_VERB_FORMS', 10);
        const candidates = await this.wikidataService.findDutchVerbsMissingForms(
          limit,
          seenByType['NL_VERB_FORMS'],
        );
        console.log('[pipeline] NL_VERB_FORMS candidates:', candidates.length);
        if (candidates.length === 0) {
          this.logger.log(
            `NL_VERB_FORMS: 0 candidates (${seenByType['NL_VERB_FORMS']?.size ?? 0} already processed). Clear processed state in Danger Zone to re-scan.`,
          );
        }
        const phaseIndex = 1;
        const totalInPhase = Math.max(candidates.length, 1);
        this.setProgress('Verb forms', phaseIndex, 0, totalInPhase);
        let verbPhaseCreated = 0;
        let verbPhaseSkipped = 0;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          this.setProgress('Verb forms', phaseIndex, i + 1, totalInPhase);
          const existing = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_VERB_FORMS',
              status: 'pending',
            },
          });
          if (existing) {
            verbPhaseSkipped++;
            skipped++;
            continue;
          }

          const missingSlots = findMissingVerbForms(candidate.lemma, candidate.existingForms);

          if (missingSlots.length === 0) {
            verbPhaseSkipped++;
            skipped++;
            continue;
          }

          // We let the LLM infer strong/weak classes; pass a neutral hint.
          const verbClass: 'weak' | 'strong' | 'unknown' = 'unknown';

          const verbGlosses: Record<string, string> = {};
          for (const sense of candidate.senses) {
            Object.assign(verbGlosses, sense.glosses);
          }
          const verbPreviousRejection = await this.getLastRejectionFeedback(
            candidate.lexemeId,
            'NL_VERB_FORMS',
          );
          // Call LLM once for all missing forms of this verb
          const llmResult = await this.llmService.suggestVerbForms({
            infinitive: candidate.lemma,
            verbClass,
            existingForms: candidate.existingForms.map((f) => ({
              form: Object.values(f.representations)[0] ?? '',
              featureLabels: f.grammaticalFeatures,
            })),
            missingSlots: missingSlots.map((s) => ({
              slotId: s.slot.slotId,
              label: s.slot.label,
              proposedForm: s.proposedForm,
            })),
            lexemeStatementIds: candidate.lexemeStatementIds ?? [],
            existingGlosses: Object.keys(verbGlosses).length > 0 ? verbGlosses : undefined,
            previousRejection: verbPreviousRejection ?? undefined,
            recentRejectionsForType:
              verbRejectionsForType.length > 0 ? verbRejectionsForType : undefined,
          });

          // Build merged proposals – LLM-first: if the LLM has no form we do not
          // fall back to any rule-based proposal.
          const formProposals: VerbFormProposal[] = missingSlots.map((s) => {
            const llmForm = llmResult.forms.find((f) => f.slotId === s.slot.slotId);
            return {
              slotId: s.slot.slotId,
              label: s.slot.label,
              grammaticalFeatures: s.slot.grammaticalFeatures,
              proposedForm: llmForm?.finalForm ?? null,
              finalForm: llmForm?.finalForm ?? null,
              confidence: llmForm?.confidence ?? 0,
              needsLlm: s.needsLlm,
            };
          });

          // Skip if LLM couldn't fill anything useful
          const hasFillableForm = formProposals.some((f) => f.finalForm !== null);
          if (!hasFillableForm) {
            verbPhaseSkipped++;
            skipped++;
            continue;
          }

          const suggestion = this.suggestionRepo.create({
            lexemeId: candidate.lexemeId,
            languageCode: 'nl',
            suggestionType: 'NL_VERB_FORMS',
            payload: {
              lemma: candidate.lemma,
              verbClass,
              missingSlotCount: missingSlots.length,
              forms: formProposals,
            },
            rationale: `${formProposals.length} missing form(s) detected (${verbClass} verb). ${llmResult.overallRationale}`,
            ruleConfidence: null,
            llmConfidence: llmResult.llmConfidence,
            status: 'pending',
          });

          const duplicateVerb = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_VERB_FORMS',
              status: 'pending',
            },
          });
          if (duplicateVerb) {
            verbPhaseSkipped++;
            skipped++;
            continue;
          }
          await this.suggestionRepo.save(suggestion);
          await this.markLexemeProcessed(candidate.lexemeId, 'NL_VERB_FORMS', 'suggestion_created');
          verbPhaseCreated++;
          created++;
          console.log('[pipeline] created NL_VERB_FORMS', candidate.lexemeId, candidate.lemma);
        }
        console.log('[pipeline] NL_VERB_FORMS phase done', {
          created: verbPhaseCreated,
          skipped: verbPhaseSkipped,
        });
      }

      if (features['NL_ADJECTIVE_FORMS']) {
        this.logger.log('Running NL_ADJECTIVE_FORMS pipeline...');

        const adjRejectionsForType = await this.getRejectionFeedbackForType(
          'NL_ADJECTIVE_FORMS',
          10,
        );
        const spec = getExpectedFormsSpec('nl', NL_CATEGORY.adjective)!;
        const candidates = await this.wikidataService.findDutchAdjectivesMissingForms(
          limit,
          seenByType['NL_ADJECTIVE_FORMS'],
        );
        console.log('[pipeline] NL_ADJECTIVE_FORMS candidates:', candidates.length);
        if (candidates.length === 0) {
          this.logger.log(
            `NL_ADJECTIVE_FORMS: 0 candidates (${seenByType['NL_ADJECTIVE_FORMS']?.size ?? 0} already processed). Clear processed state in Danger Zone to re-scan.`,
          );
        }
        const phaseIndex = 2;
        const totalInPhase = Math.max(candidates.length, 1);
        this.setProgress('Adjective forms', phaseIndex, 0, totalInPhase);
        let adjPhaseCreated = 0;
        let adjPhaseSkipped = 0;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          this.setProgress('Adjective forms', phaseIndex, i + 1, totalInPhase);
          const existing = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_ADJECTIVE_FORMS',
              status: 'pending',
            },
          });
          if (existing) {
            adjPhaseSkipped++;
            skipped++;
            continue;
          }

          const gaps = detectGaps(spec, candidate.lemma, candidate.existingForms);
          if (gaps.length === 0) {
            adjPhaseSkipped++;
            skipped++;
            continue;
          }

          // Build slot inputs for LLM
          const missingSlots = gaps.map((g) => ({
            slotId: g.slot.slotId,
            label: g.slot.label,
            proposedForm: g.proposedForm,
          }));

          const adjGlosses: Record<string, string> = {};
          for (const sense of candidate.senses) {
            Object.assign(adjGlosses, sense.glosses);
          }
          const adjPreviousRejection = await this.getLastRejectionFeedback(
            candidate.lexemeId,
            'NL_ADJECTIVE_FORMS',
          );
          const llmResult = await this.llmService.suggestAdjectiveForms({
            lemma: candidate.lemma,
            missingSlots,
            lexemeStatementIds: candidate.lexemeStatementIds ?? [],
            existingGlosses: Object.keys(adjGlosses).length > 0 ? adjGlosses : undefined,
            previousRejection: adjPreviousRejection ?? undefined,
            recentRejectionsForType:
              adjRejectionsForType.length > 0 ? adjRejectionsForType : undefined,
          });

          const formProposals: VerbFormProposal[] = gaps.map((g) => {
            const llmForm = llmResult.forms.find((f) => f.slotId === g.slot.slotId);
            return {
              slotId: g.slot.slotId,
              label: g.slot.label,
              grammaticalFeatures: g.slot.grammaticalFeatures,
              // For adjectives we are LLM-first; if the LLM has no form, we
              // treat the slot as genuinely unfillable instead of falling back
              // to any rule-based proposal.
              proposedForm: llmForm?.finalForm ?? null,
              finalForm: llmForm?.finalForm ?? null,
              confidence: llmForm?.confidence ?? 0,
              needsLlm: g.needsLlm,
            };
          });

          const hasFillableForm = formProposals.some((f) => f.finalForm !== null);
          if (!hasFillableForm) {
            await this.markLexemeProcessed(candidate.lexemeId, 'NL_ADJECTIVE_FORMS', 'no_gap');
            adjPhaseSkipped++;
            skipped++;
            continue;
          }

          const suggestion = this.suggestionRepo.create({
            lexemeId: candidate.lexemeId,
            languageCode: 'nl',
            suggestionType: 'NL_ADJECTIVE_FORMS',
            payload: {
              lemma: candidate.lemma,
              missingSlotCount: gaps.length,
              forms: formProposals,
            },
            rationale: `${gaps.length} missing form(s) detected. ${llmResult.overallRationale}`,
            ruleConfidence: null,
            llmConfidence: llmResult.llmConfidence,
            status: 'pending',
          });

          const duplicateAdj = await this.suggestionRepo.findOne({
            where: {
              lexemeId: candidate.lexemeId,
              suggestionType: 'NL_ADJECTIVE_FORMS',
              status: 'pending',
            },
          });
          if (duplicateAdj) {
            adjPhaseSkipped++;
            skipped++;
            continue;
          }
          await this.suggestionRepo.save(suggestion);
          await this.markLexemeProcessed(
            candidate.lexemeId,
            'NL_ADJECTIVE_FORMS',
            'suggestion_created',
          );
          adjPhaseCreated++;
          created++;
          console.log('[pipeline] created NL_ADJECTIVE_FORMS', candidate.lexemeId, candidate.lemma);
        }
        console.log('[pipeline] NL_ADJECTIVE_FORMS phase done', {
          created: adjPhaseCreated,
          skipped: adjPhaseSkipped,
        });
      }

      console.log('[pipeline] complete:', { created, skipped });
      this.logger.log(`Pipeline complete: ${created} created, ${skipped} skipped.`);
      return { created, skipped };
    } finally {
      this.pipelineRunning = false;
      this.pipelineProgress = null;
    }
  }

  /**
   * Clear all processed-lexeme records so the pipeline can re-scan everything.
   * This does NOT delete suggestions themselves.
   */
  async clearProcessed(): Promise<{ deleted: number }> {
    const result = await this.processedLexemeRepo
      .createQueryBuilder()
      .delete()
      .from('processed_lexemes')
      .execute();
    return { deleted: result.affected ?? 0 };
  }
}
