/**
 * Central registry of supported languages and their suggestion types.
 *
 * To add a new language: append a new entry to LANGUAGES.
 * To add a new suggestion type: append to the relevant language's `types` array.
 * The `value` must match the SuggestionType enum on the backend.
 */

export interface SuggestionTypeDefinition {
  value: string;
  label: string;
  description: string;
  /** Tailwind classes for Badge (e.g. bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300). */
  badgeClassName: string;
}

export interface LanguageDefinition {
  code: string;
  label: string;
  types: SuggestionTypeDefinition[];
}

export const LANGUAGES: LanguageDefinition[] = [
  {
    code: 'nl',
    label: 'Dutch (NL)',
    types: [
      {
        value: 'NL_NOUN_PLURAL_FORM',
        label: 'Noun plural',
        description: 'Missing plural form for a Dutch noun lexeme',
        badgeClassName:
          'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      },
      {
        value: 'NL_VERB_FORMS',
        label: 'Verb forms',
        description: 'Missing conjugated forms for a Dutch verb lexeme',
        badgeClassName:
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      },
      {
        value: 'NL_ADJECTIVE_FORMS',
        label: 'Adjective forms',
        description:
          'Missing comparison forms (comparative, superlative) for a Dutch adjective lexeme',
        badgeClassName:
          'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 border-violet-200 dark:border-violet-800',
      },
      {
        value: 'ITEM_LABEL_NL_FROM_EN',
        label: 'Item label',
        description: 'Missing Dutch label derived from the English label',
        badgeClassName:
          'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      },
    ],
  },
  // Add more languages here, e.g.:
  // {
  //   code: "de",
  //   label: "German (DE)",
  //   types: [
  //     { value: "DE_NOUN_PLURAL_FORM", label: "Noun plural", description: "..." },
  //   ],
  // },
];

/** All types across all languages, deduped by value. */
export function getAllTypes(): SuggestionTypeDefinition[] {
  const seen = new Set<string>();
  return LANGUAGES.flatMap((l) => l.types).filter((t) => {
    if (seen.has(t.value)) return false;
    seen.add(t.value);
    return true;
  });
}

/** Types for a specific language code, or all types when code is "all". */
export function getTypesForLanguage(languageCode: string): SuggestionTypeDefinition[] {
  if (languageCode === 'all') return getAllTypes();
  return LANGUAGES.find((l) => l.code === languageCode)?.types ?? [];
}

/** Human-readable label for a suggestion type value. */
export function getSuggestionTypeLabel(value: string): string {
  return getAllTypes().find((t) => t.value === value)?.label ?? value;
}

/** Badge className for a suggestion type value (custom colors). */
export function getSuggestionTypeBadgeClass(value: string): string {
  return getAllTypes().find((t) => t.value === value)?.badgeClassName ?? '';
}
