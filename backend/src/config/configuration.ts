export const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',

  database: {
    url:
      process.env.DATABASE_URL ??
      'postgres://wikidata_gap_fixer:secret@localhost:5432/wikidata_gap_fixer',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-5-nano',
    maxOutputTokens: parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? '1024', 10),
  },

  wikidata: {
    oauthClientId: process.env.WIKIDATA_OAUTH_CLIENT_ID ?? '',
    accessToken: process.env.WIKIDATA_OAUTH_ACCESS_TOKEN ?? '',
    sparqlEndpoint: 'https://query.wikidata.org/sparql',
    apiBaseUrl: 'https://www.wikidata.org/w/api.php',
    oauthProfileUrl: 'https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile',
  },

  features: {
    llmEnabled: process.env.LLM_ENABLED !== 'false',
    suggestionTypes: {
      NL_NOUN_PLURAL_FORM: process.env.SUGGESTION_TYPE_NL_NOUN_PLURAL !== 'false',
      NL_VERB_FORMS: process.env.SUGGESTION_TYPE_NL_VERB_FORMS !== 'false',
      NL_ADJECTIVE_FORMS: process.env.SUGGESTION_TYPE_NL_ADJECTIVE_FORMS !== 'false',
    },
  },

  rules: {
    minRuleConfidence: parseFloat(process.env.MIN_RULE_CONFIDENCE ?? '0.7'),
    maxSuggestionsPerBatch: parseInt(process.env.MAX_SUGGESTIONS_PER_BATCH ?? '200', 10),
    activeLanguages: ['nl'],
    /** When true, only fetch this many candidates per suggestion type (for quick testing). */
    pipelineTestLimit:
      process.env.PIPELINE_TEST_MODE === 'true'
        ? parseInt(process.env.PIPELINE_TEST_LIMIT ?? '1', 10)
        : null,
  },
});

export type AppConfig = ReturnType<typeof configuration>;
