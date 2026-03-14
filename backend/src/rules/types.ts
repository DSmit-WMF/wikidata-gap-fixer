/**
 * Shared types for the expected-forms gap-detection framework.
 *
 * Separation of concerns:
 *   FormSlot           – what a form IS (label, Wikidata features)
 *   ExpectedFormsSpec  – what forms a lexeme of a given lang/category SHOULD have,
 *                        plus a SlotDeriver that knows HOW to propose a form
 *   FormGap            – one missing slot with a proposed value ready for review
 */

import type { ExistingForm } from '../wikidata/wikidata.service';

export type { ExistingForm };

/** One slot in a lexeme paradigm. */
export interface FormSlot {
  /** Stable identifier, e.g. 'plural', 'pres_1sg', 'comparative' */
  slotId: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** Wikidata QIDs that together identify this form */
  grammaticalFeatures: string[];
}

/** Result returned by a SlotDeriver for one slot. */
export interface DerivationResult {
  /** The proposed form string, or null when derivation is uncertain */
  form: string | null;
  /** 0–1 confidence in the rule-derived form */
  confidence: number;
  /** Whether the LLM must supply / validate this form */
  needsLlm: boolean;
  ruleId?: string;
  ruleDescription?: string;
}

/**
 * A function that proposes a form for a given slot.
 *
 * Return `'skip'` to omit a slot entirely from gap reporting
 * (e.g. plural for a known uncountable noun).
 */
export type SlotDeriver = (
  slot: FormSlot,
  lemma: string,
  existingForms: ExistingForm[],
) => DerivationResult | 'skip';

/**
 * Full specification for the expected forms of a lexical category in one language.
 * Register instances in `rules/nl/expected-forms.ts` (and future language directories).
 */
export interface ExpectedFormsSpec {
  /** BCP-47 language code, e.g. 'nl' */
  language: string;
  /** Wikidata QID for the lexical category, e.g. 'Q1084' (noun) */
  lexicalCategory: string;
  /** All slots a complete lexeme of this category should have */
  slots: FormSlot[];
  /** Derive a proposed form for one slot */
  derive: SlotDeriver;
}

/** One detected gap with a ready-to-review proposal. */
export interface FormGap {
  slot: FormSlot;
  proposedForm: string | null;
  confidence: number;
  needsLlm: boolean;
  ruleId?: string;
  ruleDescription?: string;
}
