/**
 * Dutch adjective slots for expected-form detection.
 *
 * We no longer use hand-written morphology rules here; the LLM is responsible
 * for proposing comparative and superlative forms. This module only defines
 * the paradigm (which slots exist, which Wikidata features they carry) and a
 * trivial slot-deriver used by the generic gap detector.
 */

import type { DerivationResult, FormSlot } from '../types';

import type { ExistingForm } from '../../wikidata/wikidata.service';

// ---------------------------------------------------------------------------
// QIDs for adjective grammatical features
// ---------------------------------------------------------------------------

export const Q_ADJ = {
  positive: 'Q3482678',
  comparative: 'Q14169499',
  superlative: 'Q1817208',
} as const;

// ---------------------------------------------------------------------------
// Form slots for a full Dutch adjective paradigm
// ---------------------------------------------------------------------------

export const DUTCH_ADJECTIVE_SLOTS: FormSlot[] = [
  {
    slotId: 'positive',
    label: 'positive (base)',
    grammaticalFeatures: [Q_ADJ.positive],
  },
  {
    slotId: 'comparative',
    label: 'comparative',
    grammaticalFeatures: [Q_ADJ.comparative],
  },
  {
    slotId: 'superlative',
    label: 'superlative',
    grammaticalFeatures: [Q_ADJ.superlative],
  },
];

// ---------------------------------------------------------------------------
// Blocklists
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public slot deriver
// ---------------------------------------------------------------------------

export function deriveAdjectiveForm(
  slot: FormSlot,
  _lemma: string,
  _existingForms: ExistingForm[],
): DerivationResult | 'skip' {
  if (slot.slotId === 'positive') {
    return 'skip'; // positive form is the lemma itself
  }

  // For comparative/superlative we don't derive anything here; we only
  // instruct the gap detector to create a missing slot that the LLM must fill.
  return {
    form: null,
    confidence: 0,
    needsLlm: true,
  };
}
