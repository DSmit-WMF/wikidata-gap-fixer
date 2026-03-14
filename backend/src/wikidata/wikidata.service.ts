import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosResponse } from 'axios';

interface SparqlBinding {
  lexeme?: { value: string };
  lemma?: { value: string };
  item?: { value: string };
  enLabel?: { value: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

/** Property "has characteristic" (e.g. singulare tantum, plurale tantum). */
const P_HAS_CHARACTERISTIC = 'P1552';

interface WikidataEntityForm {
  id: string;
  representations: Record<string, { value: string }>;
  grammaticalFeatures: string[];
}

interface WikidataEntitySense {
  id: string;
  glosses: Record<string, { value: string }>;
}

/** Claim snak with entity value (item Q-id). */
interface ClaimEntityValue {
  'entity-type': string;
  id: string;
}

interface WikidataEntity {
  forms?: WikidataEntityForm[];
  senses?: WikidataEntitySense[];
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: ClaimEntityValue } } }>>;
}

interface WikidataEntitiesResponse {
  entities: Record<string, WikidataEntity>;
}

interface WikidataTokenResponse {
  query: { tokens: { csrftoken: string } };
}

export interface LexemeCandidate {
  lexemeId: string;
  lemma: string;
  pos: string;
  languageCode: string;
  existingForms: ExistingForm[];
  senses: LexemeSense[];
  /** Q-IDs from lexeme statements (e.g. P1552 has characteristic: Q604984 singulare tantum). */
  lexemeStatementIds: string[];
}

export interface ExistingForm {
  formId: string;
  representations: Record<string, string>;
  grammaticalFeatures: string[];
}

export interface LexemeSense {
  senseId: string;
  glosses: Record<string, string>;
}

/** Item that has an English label but no Dutch label (for ITEM_LABEL_NL_FROM_EN). */
export interface ItemLabelCandidate {
  itemId: string;
  englishLabel: string;
}

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500;
const MAX_RETRIES = 4;
/** Page size when paginating SPARQL so we can skip past already-processed lexemes. */
const SPARQL_PAGE_SIZE = 1000;
/** Max SPARQL pages to fetch (avoids runaway when most results are already processed). */
const MAX_SPARQL_PAGES = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class WikidataService {
  private readonly logger = new Logger(WikidataService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Build headers for Wikidata API requests, including the configured OAuth access token when set.
   */
  private getWikidataHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'WikidataGapFixer/0.1 (hackathon tool)',
    };
    const token = this.config.get<string>('wikidata.accessToken');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Run a SPARQL query and return raw bindings (for lexeme queries: lexeme, lemma).
   */
  private async runSparqlBindings(query: string): Promise<Record<string, { value: string }>[]> {
    const sparqlEndpoint = this.config.get<string>('wikidata.sparqlEndpoint')!;
    const response: AxiosResponse<SparqlResponse> = await this.getWithRetry<SparqlResponse>(
      sparqlEndpoint,
      { query, format: 'json' },
    );
    return response.data.results.bindings as Record<string, { value: string }>[];
  }

  /**
   * Run a SPARQL query and return lexeme ID + lemma rows. Query must include ORDER BY for stable pagination.
   */
  private async runSparqlPage(query: string): Promise<Array<{ lexemeId: string; lemma: string }>> {
    const bindings = await this.runSparqlBindings(query);
    return bindings
      .filter((row) => row.lexeme && row.lemma)
      .map((row) => ({
        lexemeId: (row.lexeme as { value: string }).value.replace(
          'http://www.wikidata.org/entity/',
          '',
        ),
        lemma: (row.lemma as { value: string }).value,
      }));
  }

  /**
   * Paginate SPARQL: keep requesting pages (OFFSET/LIMIT) until we have `limit` rows that are not in excludeLexemes, or we run out of results.
   */
  private async runSparqlPaginated(
    selectWhere: string,
    limit: number,
    excludeLexemes?: Set<string>,
  ): Promise<Array<{ lexemeId: string; lemma: string }>> {
    const collected: Array<{ lexemeId: string; lemma: string }> = [];
    const seenLexemeIds = new Set<string>();
    let offset = 0;
    for (let page = 0; page < MAX_SPARQL_PAGES && collected.length < limit; page++) {
      const query =
        `${selectWhere}\nORDER BY ?lexeme\nOFFSET ${offset}\nLIMIT ${SPARQL_PAGE_SIZE}`.trim();
      const rows = await this.runSparqlPage(query);
      const filtered = excludeLexemes ? rows.filter((r) => !excludeLexemes.has(r.lexemeId)) : rows;
      for (const r of filtered) {
        if (seenLexemeIds.has(r.lexemeId)) continue;
        seenLexemeIds.add(r.lexemeId);
        collected.push(r);
        if (collected.length >= limit) break;
      }
      if (rows.length < SPARQL_PAGE_SIZE) break;
      offset += SPARQL_PAGE_SIZE;
    }
    return collected.slice(0, limit);
  }

  /**
   * Fetch a URL with automatic retry on 429 / 5xx using exponential back-off.
   */
  private async getWithRetry<T>(
    url: string,
    params: Record<string, string>,
  ): Promise<AxiosResponse<T>> {
    const headers = this.getWikidataHeaders();
    let delay = 1000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await axios.get<T>(url, {
          params,
          headers,
          timeout: 30000,
        });
      } catch (err: unknown) {
        const status = axios.isAxiosError(err) && err.response ? err.response.status : 0;
        const retryable = status === 429 || status >= 500;
        if (!retryable || attempt === MAX_RETRIES) throw err;
        this.logger.warn(
          `HTTP ${status} — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await sleep(delay);
        delay *= 2;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * Extract Q-IDs from lexeme statements that are relevant for gap detection
   * (e.g. P1552 has characteristic → singulare tantum Q604984, plurale tantum Q138246).
   */
  private extractLexemeStatementIds(entity: WikidataEntity): string[] {
    const ids: string[] = [];
    const claims = entity.claims?.[P_HAS_CHARACTERISTIC];
    if (!claims) return ids;
    for (const c of claims) {
      const value = c.mainsnak?.datavalue?.value;
      if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
        ids.push(value.id);
      }
    }
    return ids;
  }

  /**
   * Fetch a batch of up to 50 lexeme entities in one API call.
   */
  private async fetchLexemeBatch(
    lexemeIds: string[],
  ): Promise<
    Record<
      string,
      { existingForms: ExistingForm[]; senses: LexemeSense[]; lexemeStatementIds: string[] }
    >
  > {
    const apiBase = this.config.get<string>('wikidata.apiBaseUrl')!;

    const response = await this.getWithRetry<WikidataEntitiesResponse>(apiBase, {
      action: 'wbgetentities',
      ids: lexemeIds.join('|'),
      format: 'json',
      props: 'claims|forms|senses',
    });

    const result: Record<
      string,
      { existingForms: ExistingForm[]; senses: LexemeSense[]; lexemeStatementIds: string[] }
    > = {};

    for (const lexemeId of lexemeIds) {
      const entity = response.data.entities[lexemeId];
      if (!entity) continue;

      const lexemeStatementIds = this.extractLexemeStatementIds(entity);

      result[lexemeId] = {
        existingForms: (entity.forms ?? []).map((f) => ({
          formId: f.id,
          representations: Object.fromEntries(
            Object.entries(f.representations).map(([lang, rep]) => [lang, rep.value]),
          ),
          grammaticalFeatures: f.grammaticalFeatures ?? [],
        })),
        senses: (entity.senses ?? []).map((s) => ({
          senseId: s.id,
          glosses: Object.fromEntries(
            Object.entries(s.glosses).map(([lang, g]) => [lang, g.value]),
          ),
        })),
        lexemeStatementIds,
      };
    }

    return result;
  }

  /**
   * Fetch details for many lexeme IDs in batches, with throttling between batches.
   */
  private async fetchLexemeDetailsBatched(
    rows: Array<{ lexemeId: string; lemma: string }>,
    pos: string,
  ): Promise<LexemeCandidate[]> {
    const candidates: LexemeCandidate[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const ids = batch.map((r) => r.lexemeId);

      this.logger.debug(
        `Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${ids.length} entities)`,
      );

      let batchData: Record<
        string,
        { existingForms: ExistingForm[]; senses: LexemeSense[]; lexemeStatementIds: string[] }
      > = {};
      try {
        batchData = await this.fetchLexemeBatch(ids);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Batch ${ids.join(',')} failed after retries: ${msg}`);
      }

      for (const { lexemeId, lemma } of batch) {
        const details = batchData[lexemeId];
        if (!details) continue;
        candidates.push({
          lexemeId,
          lemma,
          pos,
          languageCode: 'nl',
          existingForms: details.existingForms,
          lexemeStatementIds: details.lexemeStatementIds ?? [],
          senses: details.senses,
        });
      }

      if (i + BATCH_SIZE < rows.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return candidates;
  }

  /**
   * Find Dutch nouns that are missing a plural form.
   * Paginates SPARQL (OFFSET/LIMIT) so we can get fresh candidates after many have been processed.
   */
  async findDutchNounsMissingPlural(
    limit = 200,
    excludeLexemes?: Set<string>,
  ): Promise<LexemeCandidate[]> {
    const selectWhere = `
SELECT DISTINCT ?lexeme ?lemma WHERE {
  ?lexeme a ontolex:LexicalEntry ;
    wikibase:lexicalCategory wd:Q1084 ;
    dct:language wd:Q7411 ;
    wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "nl")
  FILTER NOT EXISTS {
    ?lexeme ontolex:lexicalForm ?form .
    ?form wikibase:grammaticalFeature wd:Q146786 .
  }
}`.trim();
    const rows = await this.runSparqlPaginated(selectWhere, limit, excludeLexemes);
    return this.fetchLexemeDetailsBatched(rows, 'noun');
  }

  /**
   * Find Dutch verbs that are missing at least one conjugated form.
   * Paginates SPARQL so we can get fresh candidates after many have been processed.
   */
  async findDutchVerbsMissingForms(
    limit = 100,
    excludeLexemes?: Set<string>,
  ): Promise<LexemeCandidate[]> {
    const selectWhere = `
SELECT DISTINCT ?lexeme ?lemma WHERE {
  ?lexeme a ontolex:LexicalEntry ;
    wikibase:lexicalCategory wd:Q24905 ;
    dct:language wd:Q7411 ;
    wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "nl")
  FILTER(STRSTARTS(STR(?lemma), ""))
  FILTER NOT EXISTS {
    ?lexeme ontolex:lexicalForm ?form .
    ?form wikibase:grammaticalFeature wd:Q110786 ;
          wikibase:grammaticalFeature wd:Q1994301 .
  }
}`.trim();
    const rows = await this.runSparqlPaginated(selectWhere, limit, excludeLexemes);
    return this.fetchLexemeDetailsBatched(rows, 'verb');
  }

  /**
   * Find Dutch adjectives that are missing a comparative form.
   * Paginates SPARQL so we can get fresh candidates after many have been processed.
   */
  async findDutchAdjectivesMissingForms(
    limit = 100,
    excludeLexemes?: Set<string>,
  ): Promise<LexemeCandidate[]> {
    const selectWhere = `
SELECT DISTINCT ?lexeme ?lemma WHERE {
  ?lexeme a ontolex:LexicalEntry ;
    wikibase:lexicalCategory wd:Q34698 ;
    dct:language wd:Q7411 ;
    wikibase:lemma ?lemma .
  FILTER(LANG(?lemma) = "nl")
  FILTER NOT EXISTS {
    ?lexeme ontolex:lexicalForm ?form .
    ?form wikibase:grammaticalFeature wd:Q14169499 .
  }
}`.trim();
    const rows = await this.runSparqlPaginated(selectWhere, limit, excludeLexemes);
    return this.fetchLexemeDetailsBatched(rows, 'adjective');
  }

  /**
   * Find Wikidata items that have an English label but no Dutch label.
   * Paginates with OFFSET so we can skip already-processed items.
   */
  async findItemsMissingDutchLabel(
    limit: number,
    excludeItemIds?: Set<string>,
  ): Promise<ItemLabelCandidate[]> {
    const collected: ItemLabelCandidate[] = [];
    const seenItemIds = new Set<string>();
    let offset = 0;
    const pageSize = 500;
    const prefix = `
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`.trim();
    for (let page = 0; page < MAX_SPARQL_PAGES && collected.length < limit; page++) {
      const query = `${prefix}
SELECT DISTINCT ?item ?enLabel WHERE {
  ?item wdt:P31 [] .
  ?item rdfs:label ?enLabel .
  FILTER(LANG(?enLabel) = "en")
  FILTER NOT EXISTS {
    ?item rdfs:label ?nlLabel .
    FILTER(LANG(?nlLabel) = "nl")
  }
}
ORDER BY ?item
OFFSET ${offset}
LIMIT ${pageSize}`;
      const bindings = await this.runSparqlBindings(query);
      for (const row of bindings) {
        const itemUri = row.item?.value;
        const enLabel = row.enLabel?.value;
        if (!itemUri || enLabel == null) continue;
        const itemId = itemUri.replace('http://www.wikidata.org/entity/', '');
        if (excludeItemIds?.has(itemId) || seenItemIds.has(itemId)) continue;
        seenItemIds.add(itemId);
        collected.push({ itemId, englishLabel: enLabel });
        if (collected.length >= limit) break;
      }
      if (bindings.length < pageSize) break;
      offset += pageSize;
    }
    return collected.slice(0, limit);
  }

  async fetchLexemeDetails(lexemeId: string): Promise<{
    existingForms: ExistingForm[];
    senses: LexemeSense[];
    lexemeStatementIds: string[];
  }> {
    const results = await this.fetchLexemeBatch([lexemeId]);
    const row = results[lexemeId];
    return row ?? { existingForms: [], senses: [], lexemeStatementIds: [] };
  }

  /**
   * Apply an edit to a Wikidata lexeme using the user's OAuth access token.
   */
  async addLexemeForm(
    lexemeId: string,
    representations: Record<string, string>,
    grammaticalFeatures: string[],
    editSummary: string,
    accessToken: string,
  ): Promise<void> {
    const apiBase = this.config.get<string>('wikidata.apiBaseUrl')!;

    // Step 1: get CSRF token
    const tokenResponse: AxiosResponse<WikidataTokenResponse> = await axios.get(apiBase, {
      params: { action: 'query', meta: 'tokens', format: 'json' },
      headers: {
        'User-Agent': 'WikidataGapFixer/0.1 (hackathon tool)',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const tokenData = tokenResponse.data as unknown as { error?: { code?: string; info?: string } };
    if (tokenData.error) {
      throw new Error(
        `Wikidata API error: ${tokenData.error.info ?? tokenData.error.code ?? 'unknown'}`,
      );
    }
    const csrfToken: string = tokenResponse.data.query.tokens.csrftoken ?? '';

    const formData = new URLSearchParams();
    formData.append('action', 'wbladdform');
    formData.append('lexemeId', lexemeId);
    formData.append(
      'data',
      JSON.stringify({
        representations: Object.fromEntries(
          Object.entries(representations).map(([lang, val]) => [
            lang,
            { language: lang, value: val },
          ]),
        ),
        grammaticalFeatures,
      }),
    );
    formData.append('summary', editSummary);
    formData.append('token', csrfToken);
    formData.append('format', 'json');

    const postResponse = await axios.post(apiBase, formData, {
      headers: {
        'User-Agent': 'WikidataGapFixer/0.1 (hackathon tool)',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const postData = postResponse.data as unknown as { error?: { code?: string; info?: string } };
    if (postData.error) {
      throw new Error(
        `Wikidata wbladdform error: ${postData.error.info ?? postData.error.code ?? 'unknown'}`,
      );
    }
  }

  /**
   * Set the label of a Wikidata item in a given language (e.g. wbsetlabel).
   */
  async setItemLabel(
    itemId: string,
    language: string,
    value: string,
    editSummary: string,
    accessToken: string,
  ): Promise<void> {
    const apiBase = this.config.get<string>('wikidata.apiBaseUrl')!;
    const tokenResponse: AxiosResponse<WikidataTokenResponse> = await axios.get(apiBase, {
      params: { action: 'query', meta: 'tokens', format: 'json' },
      headers: {
        'User-Agent': 'WikidataGapFixer/0.1 (hackathon tool)',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const tokenData = tokenResponse.data as unknown as { error?: { code?: string; info?: string } };
    if (tokenData.error) {
      throw new Error(
        `Wikidata API error: ${tokenData.error.info ?? tokenData.error.code ?? 'unknown'}`,
      );
    }
    const csrfToken: string = tokenResponse.data.query.tokens.csrftoken ?? '';
    const formData = new URLSearchParams();
    formData.append('action', 'wbsetlabel');
    formData.append('id', itemId);
    formData.append('language', language);
    formData.append('value', value);
    formData.append('summary', editSummary);
    formData.append('token', csrfToken);
    formData.append('format', 'json');
    const postResponse = await axios.post(apiBase, formData, {
      headers: {
        'User-Agent': 'WikidataGapFixer/0.1 (hackathon tool)',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const postData = postResponse.data as unknown as { error?: { code?: string; info?: string } };
    if (postData.error) {
      throw new Error(
        `Wikidata wbsetlabel error: ${postData.error.info ?? postData.error.code ?? 'unknown'}`,
      );
    }
  }
}
