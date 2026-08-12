# Auto Site Factory

Automation system for discovering emerging entities, validating search opportunities, launching sites, and learning from production feedback.

The repository currently implements **Layer 1: Signal Discovery** only.

## Implemented in Layer 1

- Monorepo: `apps/worker`, `apps/discord-gateway`, `packages/discovery`, `packages/database`, `packages/shared`
- Seven source types: Official API, Wiki, Reddit, YouTube, Discord, X, Sitemap
- Five-hour polling worker for polling sources
- Discord Gateway process for real-time `MESSAGE_CREATE` signals
- Raw signal persistence with idempotent fingerprints
- Per-target incremental cursor state
- Rule + optional OpenAI-compatible LLM entity extraction
- Conservative entity normalization and alias-ready entity registry
- Entity mentions and candidate aggregation
- Per-target/run status so one failing collector does not fail the entire batch

Layer 1 intentionally does **not** decide whether a keyword has search volume, low competition, or should become a website. Those belong to Layer 2.

## Quick start

```bash
cp .env.example .env
cp config/source-targets.example.json config/source-targets.json

docker compose up -d
npm install
npm run db:migrate
npm run targets:sync
npm run worker:once
```

Run continuously every five hours:

```bash
npm run worker
```

For Discord realtime collection, configure one or more `discord` targets and run:

```bash
npm run discord
```

## Source target configuration

Targets are data, not hard-coded code. See `config/source-targets.example.json`.

Secrets should not be stored in target JSON. Store an environment variable name such as `YOUTUBE_API_KEY` in `apiKeyEnv`; the collector resolves it at runtime.

## Data flow

```text
Source Targets
  -> Collectors
  -> Raw Signals
  -> PreFilter
  -> Rule / LLM Entity Extraction
  -> Normalization
  -> Entity Registry
  -> Entity Mentions
  -> Candidate Pool (pending_validation)
```

The full architecture is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
