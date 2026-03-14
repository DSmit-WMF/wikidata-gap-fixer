/** Wikidata IDs for grammatical features */
export const GRAMMATICAL_FEATURES = {
  plural: 'Q146786',
  singular: 'Q110786',
} as const;

import type { DerivationResult, FormSlot } from '../types';

import type { ExistingForm } from '../../wikidata/wikidata.service';

/** Form slots expected for a complete Dutch noun paradigm */
export const DUTCH_NOUN_SLOTS: FormSlot[] = [
  {
    slotId: 'singular',
    label: 'singular',
    grammaticalFeatures: [GRAMMATICAL_FEATURES.singular],
  },
  {
    slotId: 'plural',
    label: 'plural',
    grammaticalFeatures: [GRAMMATICAL_FEATURES.plural],
  },
];

export function deriveNounForm(
  slot: FormSlot,
  lemma: string,
  _existingForms: ExistingForm[],
): DerivationResult | 'skip' {
  if (slot.slotId === 'singular') {
    return {
      form: lemma,
      confidence: 1.0,
      needsLlm: false,
      ruleId: 'NL_LEMMA_IS_SINGULAR',
      ruleDescription: 'The lemma of a Dutch noun is its singular form',
    };
  }

  if (slot.slotId === 'plural') {
    // In the current LLM-first architecture we no longer use hand-written
    // plural rules to propose concrete forms in the pipeline. We still expose
    // the slot so the gap detector can mark it as missing and let the LLM
    // decide whether a plural exists and what it should be.
    return {
      form: null,
      confidence: 0,
      needsLlm: true,
    };
  }

  return 'skip';
}
