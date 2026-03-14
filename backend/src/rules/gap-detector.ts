import type { ExpectedFormsSpec, FormGap } from './types';

import type { ExistingForm } from '../wikidata/wikidata.service';

/**
 * Generic gap detector.
 *
 * For each slot defined in `spec.slots`, checks whether the lexeme already has
 * a form that satisfies ALL required grammatical features. If not, calls the
 * spec's deriver to obtain a proposed form and builds a FormGap.
 *
 * A slot is considered filled when at least one existing form carries every
 * QID listed in `slot.grammaticalFeatures` (subset check — the form may have
 * additional features without affecting the match).
 */
export function detectGaps(
  spec: ExpectedFormsSpec,
  lemma: string,
  existingForms: ExistingForm[],
): FormGap[] {
  const gaps: FormGap[] = [];

  for (const slot of spec.slots) {
    const isFilled = existingForms.some((form) =>
      slot.grammaticalFeatures.every((feat) => form.grammaticalFeatures.includes(feat)),
    );
    if (isFilled) continue;

    const result = spec.derive(slot, lemma, existingForms);
    if (result === 'skip') continue;

    gaps.push({
      slot,
      proposedForm: result.form,
      confidence: result.confidence,
      needsLlm: result.needsLlm,
      ruleId: result.ruleId,
      ruleDescription: result.ruleDescription,
    });
  }

  return gaps;
}
