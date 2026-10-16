# Media.io Sitemap watch

The Dashboard has an independent `/discovery/media-io` page. Target: `sitemap-media-io`, configured in `config/source-targets.json`.

- Every Discovery Cron run polls `https://www.media.io/sitemap.xml` and its child sitemaps.
- First **successful complete** crawl writes a baseline into `sitemap_urls`; historical URLs do not appear in the "new" report.
- Subsequent new URLs are written to `sitemap_urls`, enriched with page `title` and `h1`, and only reported once.
- Dashboard initially filters titles containing both the standalone words "AI" and "Generator", regardless of separation or word order. Turning that option off shows all newly discovered URLs (including rows with missing titles).
- Times are **monitor first-seen**, not first indexed by Google or necessarily first published.
- Cap on displayed results: 200 most recent per date range. Counts are computed across the full range.
- Settings: `requireCompleteSnapshot=true` fails before reconciliation if a sitemap child or URL limit is hit, avoiding false new URLs from partial coverage.
- Endpoint (Cloudflare Pages + local API): `GET /api/sitemap/media-io?range=7d&generatorsOnly=true`.
- Data and collection errors are surfaced through the existing Sitemap targets, runs, and anomaly pages.

Run `npm run build` and `npm test` before merging. The existing Discovery Cron syncs the target into the database and runs the collector on the next scheduled/triggered execution. It is not a Google index-date service.

If Media.io exceeds 200 child sitemaps or 100,000 URLs, change the root into stable disjoint partitions or rework pagination before raising completeness limits. Do not disable the completeness guard for this site.
