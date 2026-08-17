# Auto Site Factory

Automation system for discovering emerging entities, validating search opportunities, launching sites, and learning from production feedback.

The repository currently implements **Layer 1: Signal Discovery** only.

## Implemented in Layer 1

- Monorepo: `apps/worker`, `apps/discord-gateway`, `apps/api`, `apps/dashboard`, `packages/discovery`, `packages/database`, `packages/shared`
- Nine source types: Official API, IGDB, Steam Store, Wiki/Fandom, Reddit, YouTube, Discord, X, Sitemap
- Concrete starter source registry covering AI, tools, Roblox/game ecosystems, and directory sitemap discovery
- Five-hour polling worker for polling sources
- Discord Gateway process for real-time `MESSAGE_CREATE` signals
- Raw signal persistence with idempotent fingerprints
- Per-target incremental cursor state
- Rule + optional OpenAI-compatible LLM entity extraction
- Conservative entity normalization and alias-ready entity registry
- Entity mentions and candidate aggregation
- Per-target/run status so one failing collector does not fail the entire batch
- Production-oriented Sitemap subsystem migrated from `CoderLim/sitemap-monitor`
- Steam lifecycle monitor for newly observed apps: game classification, Store status, release date, Demo/Playtest and CCU history
- Discovery Dashboard for cross-source candidates, Steam games, Sitemap management, manual runs and anomalies

Layer 1 intentionally does **not** decide whether a keyword has search volume, low competition, or should become a website. Those belong to Layer 2.

## Quick start

A real starter registry is committed at `config/source-targets.json`. Public sources are enabled by default; sources requiring API credentials or Discord access remain disabled until configured.

```bash
cp .env.example .env

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

Run Sitemap only:

```bash
npm run sitemap:once
```

Run the public Steam upcoming/new-release sources only:

```bash
npm run steam-store:once
```

Run Steam lifecycle discovery/monitoring once:

```bash
npm run steam:once
```

The lifecycle monitor currently uses the keyless, deprecated `ISteamApps/GetAppList/v2` endpoint to establish a baseline and find newly observed AppIDs. New AppIDs are then classified with Steam Store metadata so only real games appear in the Steam Dashboard. The first run is baseline-only; later runs treat previously unseen AppIDs as discoveries.

For Discord realtime collection, complete the relay configuration described in [`docs/SOURCES.md`](docs/SOURCES.md), enable the Discord target, then run:

```bash
npm run discord
```

## Sitemap Monitor integration

The former standalone `CoderLim/sitemap-monitor` logic has been migrated into the Factory instead of being kept as a second stateful service.

The Factory Sitemap Source now supports:

- Multiple sitemap roots
- Recursive sitemap indexes
- XML, `sitemap.txt`, and gzip
- Optional curl fallback for 403 responses
- Baseline + incremental URL detection
- URL slug keyword extraction
- Stable trailing numeric ID removal
- Page title/H1 enrichment
- PostgreSQL-backed URL history instead of storing tens of thousands of URLs in cursor JSON
- Backpressure via pending, not-yet-emitted Sitemap URLs

The old game-site targets are converted to Factory config at [`config/sitemap-targets.migrated.json`](config/sitemap-targets.migrated.json). Details are in [`docs/SITEMAP.md`](docs/SITEMAP.md).

## Dashboard

The first Factory Web Dashboard is based on the old sitemap-monitor dashboard workflow.

Terminal 1:

```bash
npm run api
```

Terminal 2:

```bash
npm run dashboard:dev
```

Open `http://127.0.0.1:5173`.

The current Discovery dashboard includes cross-source candidates (filterable by source type), Steam game lifecycle/CCU monitoring, 1/7/30 day ranges, Sitemap site management, manual collection, run history, anomalies, and Google Trends shortcuts.

## Source target configuration

Targets are data, not hard-coded code.

- [`config/source-targets.json`](config/source-targets.json): real starter registry used by the worker.
- [`config/source-targets.example.json`](config/source-targets.example.json): minimal examples for each collector type.
- [`config/sitemap-targets.migrated.json`](config/sitemap-targets.migrated.json): old sitemap-monitor targets converted to Factory format.
- [`docs/SOURCES.md`](docs/SOURCES.md): concrete source choices, enabled/disabled status, credentials, and Discord relay setup.

Secrets should not be stored in target JSON. Store an environment variable name such as `YOUTUBE_API_KEY` in `apiKeyEnv`; the collector resolves it at runtime.

YouTube targets support readable handles such as `@OpenAI`. X targets support readable usernames such as `AnthropicAI`; the collectors resolve numeric IDs at runtime.

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

For Sitemap specifically:

```text
Sitemap roots
  -> XML/TXT/Gzip parser
  -> sitemap_urls reconcile
  -> New URL + slug keyword + title/H1
  -> RawSignal
  -> Entity
  -> Candidate
```

The full architecture is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
