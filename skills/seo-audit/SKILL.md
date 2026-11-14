---
name: seo-audit
description: Technical and on-page SEO audit of a website or codebase - crawlability, indexation, canonicals, JS rendering (raw vs hydrated HTML), speed, content quality - ending in a prioritised fix list. Use for "SEO audit", "why isn't my site ranking/indexed", "check my SEO".
---

# SEO Audit

## When to use
- The user asks why pages are not indexed, traffic dropped, or wants a general SEO health check.
- Before or after a migration, redesign, framework change, or domain move.

Not for: deciding what new content to write (use content-strategy), structured data deep dives
(schema-markup), or AI answer-engine visibility (ai-search-visibility). Mention those when findings
point there.

## Gather first
- The live origin(s) and whether you may fetch them. If only the codebase is available, audit the code
  and say live behaviour is unverified.
- Framework and rendering mode: static, SSR, prerendered SPA, or client-only SPA.
- Any symptoms the user already has: Search Console messages, a traffic drop date, specific URLs.
- Which pages matter commercially, so the fix list is ranked by business impact, not by count.

## Procedure

### 1. Crawl access
- Fetch `/robots.txt`. Look for accidental `Disallow: /`, blocked asset paths (CSS/JS needed to render),
  and a `Sitemap:` line.
- Fetch the sitemap(s). Spot-check a sample of URLs: each should return 200, be canonical to itself,
  and not be noindexed. A sitemap full of redirects or 404s wastes trust.
- Check status codes directly with `curl -sI` for the home page, a deep page, a URL that should not
  exist (must be a real 404, not a 200 "soft 404" from an SPA fallback), and the http/non-www variants
  (should 301 once to the preferred origin, no chains).
- Try a crawler-like user agent and an `Accept` header a bot would send; some servers serve bots
  differently.

### 2. Indexation signals
For each key template (home, category/listing, detail, article, landing):
- `<title>` and meta description present, unique, and describe that page.
- `<link rel="canonical">` is absolute, points at the preferred URL, and there is exactly one.
- No stray `noindex` in meta robots or an `X-Robots-Tag` header.
- `hreflang` (if multilingual) is reciprocal and uses valid codes.
- Parameterised, filtered, paginated, and search-result URLs are handled deliberately
  (canonicalised, noindexed, or blocked), not left to chance.

### 3. Rendering (critical for JS sites)
Compare what a crawler sees first with what a user sees:
- **Raw HTML**: `curl -s <url>` and inspect. Are the title, canonical, headings, main copy, and
  internal links present in the response body?
- **Hydrated DOM**: if a headless browser is available (e.g. Playwright or Puppeteer, if installed),
  load the page and read the final `<head>` and content. Check that hydration does not replace a good
  title/canonical with a default one, duplicate tags, or drop content.
- If the raw HTML is an empty shell, that is usually the top finding: recommend SSR, static
  generation, or build-time prerendering for indexable routes.

### 4. On-page quality
- One clear `<h1>` matching the page's intent; logical heading order.
- The main topic and close variants appear naturally in the title, H1, opening paragraph.
- Content actually answers the query the page targets; flag thin, near-duplicate, or boilerplate-heavy
  pages.
- Images have meaningful `alt`, sensible dimensions, and modern formats.
- Internal links use descriptive anchor text and reach important pages within a few clicks.

### 5. Performance and mobile
- Run a lab measurement if a tool is available (e.g. Lighthouse CLI). Otherwise inspect: page weight,
  render-blocking scripts, unoptimised hero images, missing `width`/`height` causing layout shift, web
  fonts without `font-display`.
- Viewport meta present; tap targets and text usable on small screens.
- Treat lab numbers as directional; field data (real-user metrics) is what search engines use.

### 6. Site-wide hygiene
HTTPS everywhere, no mixed content, consistent trailing-slash policy, broken internal links (crawl a
sample and collect non-200s), redirect chains, orphan pages, and structured data that parses.

## Prioritising
Rank each finding by **impact x reach / effort**:
1. Blockers: whole site or key templates not crawlable, not indexable, or not rendered.
2. Template-level issues that affect many URLs (wrong canonical on every product page).
3. Page-level issues on high-value pages.
4. Polish.
A single wrong canonical template outranks a hundred missing alt attributes.

## Pitfalls
- Judging an SPA by the browser view only. Always check the raw response.
- Treating every tool warning as a problem. Explain why each finding matters or drop it.
- Recommending changes to URLs that rank without a redirect plan.
- Claiming ranking outcomes. You can fix eligibility and quality; you cannot promise positions.
- Overlooking staging/preview hosts that are publicly indexable and duplicate production.

## Deliver
Lead with a three-line summary: the biggest problem, its likely effect, the first fix. Then:
- A prioritised table: issue, evidence (URL + what you observed), impact, fix, effort.
- For code fixes, exact files and changes; offer to make them, and re-run the relevant check after.
- A "verified vs not verified" section: what you fetched live, what you inferred from code, and what
  needs Search Console or field data the user must check themselves.
Do not deploy or submit sitemaps/indexing requests without the user's say-so.
