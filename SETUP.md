# Setup Guide

This guide walks you through getting Wikidata Gap Fixer running locally from scratch.

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Docker & Docker Compose** — [docs.docker.com/get-docker](https://docs.docker.com/get-docker) _(optional but recommended)_
- **A Wikimedia account** — needed to register an OAuth app and to review suggestions
- **An OpenAI account** — for the LLM validation step

---

## Step 1 — Register a Wikidata OAuth 2.0 application

This allows the app to write accepted suggestions to Wikidata on behalf of the logged-in user.

1. Log in to your Wikimedia account and go to:
   **https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2**

2. Fill in the form:

   | Field                                    | Value                                                             |
   | ---------------------------------------- | ----------------------------------------------------------------- |
   | Application name                         | `Wikidata Gap Fixer` (or anything you like)                       |
   | Consumer version                         | `1.0`                                                             |
   | Applicable project                       | `*` (all projects)                                                |
   | This consumer is for use only by `<you>` | ✅ Check this for personal/dev use — it auto-approves immediately |
   | Client is confidential                   | ✅ Keep checked                                                   |
   | Types of grants                          | Select **"Request authorization for specific permissions"**       |

   > **No callback URL needed.** This app uses the owner-only access token directly — no redirect flow, no callback URL required. Leave the form defaults as-is.

3. Under **Applicable grants**, check:
   - `Edit existing pages`
   - `Basic rights` is pre-checked and cannot be unchecked

4. Leave **Allowed IP ranges** as the defaults (`0.0.0.0/0` and `::/0`).

5. Leave **Allowed pages for editing** blank (allows all pages).

6. Click **Propose consumer**. On the next page you will receive:
   - **Client ID** — copy this into `WIKIDATA_OAUTH_CLIENT_ID`
   - **Access token** — copy this into `WIKIDATA_OAUTH_ACCESS_TOKEN`

   > The access token for owner-only consumers does **not expire**. You do not need the client secret or a callback URL — the app uses the access token directly.

> **Owner-only consumers** are auto-approved and work only for your own account — ideal for local development and hackathons. For a multi-user production deployment, uncheck the owner-only box and register a separate consumer (requires Wikimedia staff approval).

---

## Step 2 — Get an OpenAI API key

1. Go to **https://platform.openai.com/api-keys**
2. Create a new secret key
3. Keep it — you won't be able to view it again

The model is configurable via `OPENAI_MODEL` in `.env`. We recommend `gpt-5-nano` — it's fast, cheap, and well-suited to the structured JSON prompts used here. A typical generation run of 200 lexemes costs a few cents. The default in `.env.example` is `gpt-5-nano`.

> **Note:** The backend uses the OpenAI Responses API (`/v1/responses`).

> If you want to run without LLM validation (rule-based only), set `LLM_ENABLED=false` in your `.env` — you can skip this step entirely.

---

## Step 3 — Generate a session secret

The backend uses an encrypted session cookie. Generate a random secret:

```bash
openssl rand -base64 32
```

Copy the output — you'll need it in the next step.

---

## Step 4 — Create your `.env` file

From the repo root:

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```dotenv
SESSION_SECRET=<output from step 3>

OPENAI_API_KEY=<your OpenAI key>
OPENAI_MODEL=gpt-5-nano           # change if you want a different model

WIKIDATA_OAUTH_CLIENT_ID=<your client ID from step 1>
WIKIDATA_OAUTH_ACCESS_TOKEN=<your access token from step 1>

# Feature flags — enable/disable suggestion types
LLM_ENABLED=true
SUGGESTION_TYPE_NL_NOUN_PLURAL=true      # Dutch noun plurals
SUGGESTION_TYPE_NL_VERB_FORMS=true       # Dutch verb paradigms
SUGGESTION_TYPE_NL_ADJECTIVE_FORMS=true  # Dutch adjective degrees (comparative/superlative)

# Rule thresholds
MIN_RULE_CONFIDENCE=0.7          # minimum rule confidence required to store a suggestion
MAX_SUGGESTIONS_PER_BATCH=200    # max candidates processed per pipeline run

# Optional: pipeline test mode (for quick iteration)
# When enabled, the backend only processes a small number of candidates
# per suggestion type (e.g. 1 noun, 1 verb, 1 adjective).
PIPELINE_TEST_MODE=false
PIPELINE_TEST_LIMIT=1
```

The database URL and ports are pre-configured for Docker and do not need changing for local development.

---

## Step 5 — Start the application

### Option A: Docker Compose (recommended)

```bash
docker compose up --build
```

Docker will start three containers: PostgreSQL, the NestJS backend, and the Next.js frontend. Wait for all three to report healthy/ready before opening the browser.

| Service      | URL                          |
| ------------ | ---------------------------- |
| Frontend     | http://localhost:3000        |
| Backend API  | http://localhost:3001        |
| Health check | http://localhost:3001/health |

### Option B: Without Docker

You need a running PostgreSQL instance. The easiest way is to start just the database via Docker:

```bash
docker compose up db
```

Then, in two separate terminals:

**Terminal 1 — backend:**

```bash
cd backend
cp .env.example .env   # fill in the same values as above
npm install
npm run start:dev
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev
```

---

## Step 6 — First use

1. Open **http://localhost:3000**
2. Click **Log in with Wikidata** — this redirects you through Wikimedia OAuth
3. After login, go to **Suggestions**
4. Click **Run pipeline** to scan Wikidata and generate the first batch of suggestions (this takes ~30–60 seconds depending on batch size)
5. Click **Review** on any suggestion to accept, edit, or reject it

---

## Troubleshooting

### Login returns "Access token is invalid or expired"

Verify that `WIKIDATA_OAUTH_ACCESS_TOKEN` in your `.env` matches exactly what was shown on the consumer registration confirmation page. Owner-only access tokens do not expire, but if you need a new one you can reset it from the consumer edit page at **https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/list**.

### Backend fails to start — database not ready

> `ECONNREFUSED` or TypeORM connection error

The backend starts before Postgres is fully ready. With Docker Compose this is handled by a healthcheck. For local dev, make sure Postgres is running first (`docker compose up db`).

### `LLM_ENABLED=true` but no suggestions are created

> Check backend logs for `OpenAI` errors

Verify your `OPENAI_API_KEY` is correct and your account has credit. You can test with `LLM_ENABLED=false` to confirm the rule engine works independently.

### Suggestions show "failed" status after accepting

> Check backend logs for Wikidata API errors

This usually means the OAuth token doesn't have sufficient grants. Re-register the OAuth app and make sure `Edit existing pages` is checked.
