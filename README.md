# Wikidata Gap Fixer

> AI-assisted suggestions to fill simple lexeme and label gaps in Wikidata — with humans in control.

## What it does

Wikidata Gap Fixer scans Wikidata for Dutch lexemes with missing morphological forms (e.g. plural nouns) and uses a combination of conservative rules and an LLM (configurable OpenAI model, e.g. `gpt-5-nano`) to generate high-confidence suggestions. Editors review each suggestion and explicitly Accept, Edit, or Reject it before anything is written to Wikidata.

## Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Backend   | NestJS (Node.js / TypeScript)                  |
| Frontend  | Next.js 14 (React / TypeScript)                |
| Database  | PostgreSQL (TypeORM)                           |
| LLM       | OpenAI (configurable model, e.g. `gpt-5-nano`) |
| Auth      | Wikidata OAuth 2.0                             |
| Dev infra | Docker Compose                                 |

## Getting started

See **[SETUP.md](./SETUP.md)** for the full step-by-step setup guide, including:

- Registering a Wikidata OAuth 2.0 application
- Getting an OpenAI API key
- Configuring `.env`
- Starting with Docker or locally
- Troubleshooting common issues

**TL;DR — production-like (Docker):**

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, WIKIDATA_OAUTH_CLIENT_ID, WIKIDATA_OAUTH_ACCESS_TOKEN, SESSION_SECRET
docker compose up --build
```

**TL;DR — development (hot-reload):**

```bash
cp .env.example .env
# fill in the same vars as above
docker compose -f docker-compose.dev.yml up --build
```

The dev compose file mounts your source directories as volumes and runs the backend with `nodemon` and the frontend with `next dev`, so changes are picked up automatically without rebuilding the image.

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## How suggestions are generated

1. **SPARQL query** finds Dutch lexemes missing plural forms (or other targeted gaps).
2. **Rule-based engine** (`backend/src/rules/nl-noun-rules.ts`) applies conservative Dutch morphology patterns to derive a candidate form. Each rule has an explicit confidence score.
3. **LLM validation** (if enabled) sends a minimal prompt to OpenAI to validate the candidate, optionally correct it, and generate a Dutch gloss. The LLM must return `ACCEPTABLE` for the suggestion to be stored.
4. Suggestions with `decision = REJECT` or below the `MIN_RULE_CONFIDENCE` threshold are discarded.
5. Accepted suggestions are stored in the `suggestions` table with `status = pending`.

## Adding new suggestion types

1. Add a new rule file in `backend/src/rules/` (e.g. `nl-verb-rules.ts`).
2. Add a new `SuggestionType` value in `suggestion.entity.ts`.
3. Add a feature flag in `configuration.ts` and `.env.example`.
4. Add a branch in `SuggestionsService.runGenerationPipeline()`.
5. Add a new LLM prompt function in `LlmService` if needed.

## Adding a new language

1. Create a `rules/<lang>/` directory with the language's morphology rules.
2. Add the language code to `rules.activeLanguages` in `configuration.ts`.
3. Extend the SPARQL query in `WikidataService` with a new language filter.
4. The rest of the pipeline (DB, API, UI) works without changes.

## Architecture

```
User → Next.js UI → NestJS REST API
                         ↓               ↓                  ↓
                  Wikidata SPARQL    OpenAI LLM          PostgreSQL
                  & API (read)       (validate)          (suggestions)
                         ↓
                  Wikidata API (write, via user OAuth token)
```

## Wikidata edit summaries

All edits applied by this tool include an explicit summary, for example:

```
Add Dutch plural form via Wikidata Gap Fixer (rule: NL_ING, manually reviewed)
```

## Desired future work

- **Custom LLM agent** — Replace one-off LLM calls with a dedicated agent that can maintain richer context (e.g. full lexeme history, similar items, user preferences). That would make it easier to inject more feedback and to improve suggestions over time.
- **Learning from rejections** — The pipeline already passes (1) the last rejection for the _same_ lexeme when it is re-scanned (e.g. after “Revoke & retry”), and (2) recent rejections for the _same suggestion type_ into every LLM call, so similar lexemes can learn from past human feedback. A future custom agent or model could learn from every rejected suggestion and comment, find patterns in that data (e.g. “compound adjectives → don’t suggest periphrastic forms”), and use them to improve suggestions or for fine-tuning.

## Disclaimer

This is a hackathon prototype. Use on Wikidata with care — always review suggestions before accepting.
