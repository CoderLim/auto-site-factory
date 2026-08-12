# Cloudflare Dashboard Deployment

The production dashboard is designed for this topology:

```text
GitHub Actions Cron
        |
        v
Supabase PostgreSQL
        ^
        | (Supabase Direct connection)
Cloudflare Hyperdrive
        ^
        |
Cloudflare Pages Functions
        ^
        |
React Dashboard
```

The scheduled discovery worker remains in GitHub Actions. Cloudflare only hosts the dashboard and its API.

## 1. Supabase connection roles

Use two different Supabase connection modes for two different runtimes:

- GitHub Actions `DATABASE_URL`: use the Supabase **Session pooler** connection string. GitHub-hosted runners may not reach the IPv6-only Direct connection endpoint.
- Cloudflare Hyperdrive: use the Supabase **Direct connection** connection string. Hyperdrive performs its own pooling.

Do not put either database connection string in the frontend build variables.

## 2. Create Hyperdrive

In Cloudflare Dashboard:

1. Go to **Storage & databases -> Hyperdrive**.
2. Create a Hyperdrive configuration.
3. Use the Supabase **Direct connection** PostgreSQL connection string.
4. Keep the default database name `postgres` unless the Supabase project was changed.

Then bind the Hyperdrive configuration to the Pages project with the exact binding name:

```text
HYPERDRIVE
```

The Pages Functions code reads `env.HYPERDRIVE.connectionString`.

## 3. Create the Cloudflare Pages project

Connect the GitHub repository:

```text
CoderLim/auto-site-factory
```

Use the repository root as the project root.

Build settings:

```text
Build command: npm run cloudflare:build
Build output directory: apps/dashboard/dist
Node version: 22
```

`wrangler.jsonc` enables `nodejs_compat`, which is required by `pg` when used with Hyperdrive.

The API is implemented by the root Pages Function:

```text
functions/api/[[path]].js
```

It serves:

```text
GET  /api/health
GET  /api/sitemap/targets
POST /api/sitemap/targets
PUT  /api/sitemap/targets/:id
GET  /api/sitemap/signals
GET  /api/sitemap/runs
GET  /api/sitemap/anomalies
POST /api/sitemap/run
```

## 4. Dashboard authentication

Recommended: add this Pages secret in Cloudflare:

```text
DASHBOARD_TOKEN=<a long random secret>
```

When `DASHBOARD_TOKEN` is configured, all API routes except `/api/health` require the same bearer token.

The dashboard does **not** bake this token into the Vite bundle. Enter the token in the Dashboard header. It is kept only in browser `sessionStorage` for the current browser session.

If `DASHBOARD_TOKEN` is omitted, the API is public. That is useful for temporary testing but is not recommended for the production dashboard because the API includes target mutations and manual discovery triggering.

## 5. Manual `Discovery Cron` trigger

The Dashboard's **立即抓取** button no longer starts a local Node process. Pages Functions calls the GitHub Actions workflow-dispatch API.

Create a GitHub fine-grained personal access token that can access `CoderLim/auto-site-factory` and has **Actions: write** permission. Store it as a Cloudflare Pages secret:

```text
GITHUB_DISPATCH_TOKEN=<token>
```

Optional Pages variables (defaults shown):

```text
GITHUB_REPOSITORY=CoderLim/auto-site-factory
GITHUB_WORKFLOW_FILE=discovery-cron.yml
GITHUB_REF=main
```

Without `GITHUB_DISPATCH_TOKEN`, the scheduled Cron still works; only the Dashboard's manual trigger returns an error.

## 6. Required Cloudflare settings summary

Bindings:

```text
HYPERDRIVE -> the Supabase Hyperdrive configuration
```

Secrets:

```text
DASHBOARD_TOKEN
GITHUB_DISPATCH_TOKEN
```

Optional variables:

```text
GITHUB_REPOSITORY
GITHUB_WORKFLOW_FILE
GITHUB_REF
```

After adding or changing a Pages binding/secret, redeploy the Pages project.

## 7. Verification

After deployment:

1. Open `/api/health` and verify it returns `auto-site-factory-pages-api`.
2. Open the Dashboard and enter `DASHBOARD_TOKEN` if configured.
3. Confirm Sitemap targets and run history load from Supabase.
4. Click **立即抓取** and confirm a new `Discovery Cron` run appears in GitHub Actions.
5. After the Action finishes, refresh the Dashboard and confirm run status / signals are updated.

## Local development

The existing Node API is intentionally kept for local development:

```bash
npm run api
npm run dashboard:dev
```

It continues to use `DATABASE_URL` directly. The Cloudflare Pages Function is the production API path.
