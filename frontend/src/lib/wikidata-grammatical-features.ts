/**
 * Human-readable labels for Wikidata grammatical feature QIDs used by the app.
 * Used to display feature names and links in the suggestion detail forms table.
 * QIDs match backend rules (verb.ts, adjective.ts, noun.ts).
 */
export const WIKIDATA_FEATURE_LABELS: Record<string, string> = {
  // Verb (Dutch)
  Q179230: 'infinitive',
  Q192613: 'present tense',
  Q1994301: 'past tense',
  Q21714344: 'first person',
  Q51929049: 'second person',
  Q51929074: 'third person',
  Q110786: 'singular',
  Q146786: 'plural',
  Q22716: 'imperative',
  Q1230649: 'past participle',
  // Adjective
  Q3482678: 'positive',
  Q14169499: 'comparative',
  Q1817208: 'superlative',
};

const WIKIDATA_ENTITY_URL = 'https://www.wikidata.org/wiki';

export function getFeatureLabel(qid: string): string {
  return WIKIDATA_FEATURE_LABELS[qid] ?? qid;
}

export function getFeatureUrl(qid: string): string {
  return `${WIKIDATA_ENTITY_URL}/${qid}`;
}
