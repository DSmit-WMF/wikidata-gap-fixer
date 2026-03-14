/**
 * Dutch expected-forms specification registry.
 *
 * Maps (language × lexical-category QID) → ExpectedFormsSpec so the generic
 * gap-detector can work without knowing anything language-specific.
 *
 * Wikidata lexical category QIDs:
 *   Q1084   = noun
 *   Q24905  = verb
 *   Q34698  = adjective
 *
 * To add a new category: create the slots + deriver in its own file, then
 * append an entry to DUTCH_SPECS below. No other code needs to change.
 */

import { DUTCH_ADJECTIVE_SLOTS, deriveAdjectiveForm } from './adjective';
import { DUTCH_NOUN_SLOTS, deriveNounForm } from './noun';
import { DUTCH_VERB_PARADIGM, Q } from './verb';
import type { DerivationResult, FormSlot } from '../types';

import type { ExistingForm } from '../../wikidata/wikidata.service';
import type { ExpectedFormsSpec } from '../types';

// ---------------------------------------------------------------------------
// Wikidata lexical-category QIDs
// ---------------------------------------------------------------------------

export const NL_CATEGORY = {
  noun: 'Q1084',
  verb: 'Q24905',
  adjective: 'Q34698',
} as const;

// ---------------------------------------------------------------------------
// Verb slot deriver — LLM-first: only marks slots as needing LLM
// ---------------------------------------------------------------------------

function deriveVerbForm(
  slot: FormSlot,
  _lemma: string,
  _existingForms: ExistingForm[],
): DerivationResult | 'skip' {
  const verbSlot = DUTCH_VERB_PARADIGM.find((s) => s.slotId === slot.slotId);
  if (!verbSlot) return 'skip';

  return {
    form: null,
    confidence: 0,
    needsLlm: true,
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

const NL_NOUN_SPEC: ExpectedFormsSpec = {
  language: 'nl',
  lexicalCategory: NL_CATEGORY.noun,
  slots: DUTCH_NOUN_SLOTS,
  derive: deriveNounForm,
};

const NL_VERB_SPEC: ExpectedFormsSpec = {
  language: 'nl',
  lexicalCategory: NL_CATEGORY.verb,
  slots: DUTCH_VERB_PARADIGM.map((s) => ({
    slotId: s.slotId,
    label: s.label,
    grammaticalFeatures: s.grammaticalFeatures,
  })),
  derive: deriveVerbForm,
};

const NL_ADJECTIVE_SPEC: ExpectedFormsSpec = {
  language: 'nl',
  lexicalCategory: NL_CATEGORY.adjective,
  slots: DUTCH_ADJECTIVE_SLOTS,
  derive: deriveAdjectiveForm,
};

// Add future language specs here, e.g. DE_NOUN_SPEC, FR_VERB_SPEC …
const ALL_SPECS: ExpectedFormsSpec[] = [NL_NOUN_SPEC, NL_VERB_SPEC, NL_ADJECTIVE_SPEC];

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

/**
 * Returns the expected-forms spec for a given language and Wikidata lexical
 * category QID, or null if no spec is registered for that combination.
 */
export function getExpectedFormsSpec(
  language: string,
  lexicalCategory: string,
): ExpectedFormsSpec | null {
  return (
    ALL_SPECS.find((s) => s.language === language && s.lexicalCategory === lexicalCategory) ?? null
  );
}

export { Q, NL_NOUN_SPEC, NL_VERB_SPEC, NL_ADJECTIVE_SPEC };
