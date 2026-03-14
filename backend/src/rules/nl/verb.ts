/**
 * Dutch verb conjugation rules.
 *
 * Covers:
 * - Weak (regular) verbs: all present, past, imperative, and participle forms
 * - Strong (irregular) verbs: present forms derivable; past/participle flagged for LLM
 *
 * Verified Wikidata grammatical feature QIDs (from L21692 "lopen"):
 *   Q179230  = infinitive
 *   Q192613  = present tense
 *   Q1994301 = past tense
 *   Q21714344 = first person
 *   Q51929049 = second person
 *   Q51929074 = third person
 *   Q110786  = singular
 *   Q146786  = plural
 *   Q22716   = imperative
 *   Q1230649 = past participle
 */

// ---------------------------------------------------------------------------
// Grammatical feature QIDs
// ---------------------------------------------------------------------------

export const Q = {
  infinitive: 'Q179230',
  presentTense: 'Q192613',
  pastTense: 'Q1994301',
  firstPerson: 'Q21714344',
  secondPerson: 'Q51929049',
  thirdPerson: 'Q51929074',
  singular: 'Q110786',
  plural: 'Q146786',
  imperative: 'Q22716',
  pastParticiple: 'Q1230649',
} as const;

// ---------------------------------------------------------------------------
// Paradigm definition – all form "slots" that a complete Dutch verb should have.
// This describes *what* forms exist, not *how* to derive them.
// ---------------------------------------------------------------------------

export interface FormSlot {
  slotId: string;
  label: string;
  example: string;
  grammaticalFeatures: string[];
  requiresAblaut: boolean;
  /**
   * If set, a slot is considered filled when any existing form has ALL features in this set.
   * Use when Wikidata often tags forms with only person/number (e.g. "second person, singular")
   * and not tense (e.g. "present tense"), so we don't require every tag to be present.
   */
  fillIfFormHas?: string[];
}

export const DUTCH_VERB_PARADIGM: FormSlot[] = [
  // Present tense (fillIfFormHas: person+number only, so forms tagged without "present tense" still count)
  {
    slotId: 'pres_1sg',
    label: '1st sg present (ik)',
    example: 'loop / werk',
    grammaticalFeatures: [Q.firstPerson, Q.singular, Q.presentTense],
    requiresAblaut: false,
    fillIfFormHas: [Q.firstPerson, Q.singular],
  },
  {
    slotId: 'pres_2sg',
    label: '2nd sg present (jij)',
    example: 'loopt / werkt',
    grammaticalFeatures: [Q.secondPerson, Q.singular, Q.presentTense],
    requiresAblaut: false,
    fillIfFormHas: [Q.secondPerson, Q.singular],
  },
  {
    slotId: 'pres_3sg',
    label: '3rd sg present (hij)',
    example: 'loopt / werkt',
    grammaticalFeatures: [Q.thirdPerson, Q.singular, Q.presentTense],
    requiresAblaut: false,
    fillIfFormHas: [Q.thirdPerson, Q.singular],
  },
  {
    slotId: 'pres_pl',
    label: 'plural present (wij)',
    example: 'lopen / werken',
    grammaticalFeatures: [Q.plural, Q.presentTense],
    requiresAblaut: false,
    fillIfFormHas: [Q.plural],
  },
  // Past tense (preterite) – keep tense so we don't confuse with present
  {
    slotId: 'past_sg',
    label: 'singular past (ik liep / werkte)',
    example: 'liep / werkte',
    grammaticalFeatures: [Q.singular, Q.pastTense],
    requiresAblaut: true,
  },
  {
    slotId: 'past_pl',
    label: 'plural past (wij liepen / werkten)',
    example: 'liepen / werkten',
    grammaticalFeatures: [Q.plural, Q.pastTense],
    requiresAblaut: true,
  },
  // Imperative
  {
    slotId: 'imp_sg',
    label: 'singular imperative',
    example: 'loop / werk',
    grammaticalFeatures: [Q.imperative, Q.singular],
    requiresAblaut: false,
  },
  {
    slotId: 'imp_pl',
    label: 'plural imperative',
    example: 'loopt / werkt',
    grammaticalFeatures: [Q.imperative, Q.plural],
    requiresAblaut: false,
  },
  // Past participle
  {
    slotId: 'past_part',
    label: 'past participle',
    example: 'gelopen / gewerkt',
    grammaticalFeatures: [Q.pastParticiple],
    requiresAblaut: true,
  },
];

// ---------------------------------------------------------------------------
// Gap analysis – which slots are missing?
// ---------------------------------------------------------------------------

export interface MissingSlot {
  slot: FormSlot;
  proposedForm: string | null;
  confidence: number;
  needsLlm: boolean;
}

export function findMissingVerbForms(
  infinitive: string,
  existingForms: Array<{
    representations: Record<string, string>;
    grammaticalFeatures: string[];
  }>,
): MissingSlot[] {
  const missingSlots: MissingSlot[] = [];

  for (const slot of DUTCH_VERB_PARADIGM) {
    const requiredToFill = slot.fillIfFormHas ?? slot.grammaticalFeatures;
    const isFilled = existingForms.some((f) =>
      requiredToFill.every((feat) => f.grammaticalFeatures.includes(feat)),
    );
    if (isFilled) continue;

    // In LLM-first mode we don't propose concrete forms here; we only
    // describe which slots are missing and let the LLM fill them.
    missingSlots.push({
      slot,
      proposedForm: null,
      confidence: 0,
      needsLlm: true,
    });
  }

  return missingSlots;
}
