# Media.io Sitemap watch

The Dashboard has an independent `/discovery/media-io` page. Target: `sitemap-media-io`, configured in `config/source-targets.json`.

- Every Discovery Cron run polls `https://www.media.io/sitemap.xml` and its child sitemaps.
- First **successful complete** crawl writes a baseline into `sitemap_urls`; historical URLs are labeled "baseline", excluded from "new" counters, and visible via the default "all" and dedicated "baseline" views.
- Subsequent new URLs are written to `sitemap_urls`, enriched with page `title` and `h1`, and only reported once.
- Dashboard initially filters for standalone words "AI" and "Generator": page title when available, otherwise URL tokens as **unverified candidates**. Baseline titles are not fetched, so the baseline view does not claim verified title matches. Turning the filter off displays all URL types.
- Server-side search covers the full baseline (not just the first 200 rows); counts report new versus historical baseline separately. Date range applies only to post-baseline new URLs.
- Times are **monitor first-seen**, not first indexed by Google or necessarily first published.
- Cap on displayed results: 200 most recent per date range. Counts are computed across the full range.
- Settings: `requireCompleteSnapshot=true` fails before reconciliation if a sitemap child or URL limit is hit, avoiding false new URLs from partial coverage.
- Endpoint (Cloudflare Pages + local API): `GET /api/sitemap/media-io?range=7d&generatorsOnly=true`.
- Data and collection errors are surfaced through the existing Sitemap targets, runs, and anomaly pages.

Run `npm run build` and `npm test` before merging. The existing Discovery Cron syncs the target into the database and runs the collector on the next scheduled/triggered execution. It is not a Google index-date service.

If Media.io exceeds 200 child sitemaps or 100,000 URLs, change the root into stable disjoint partitions or rework pagination before raising completeness limits. Do not disable the completeness guard for this site.
