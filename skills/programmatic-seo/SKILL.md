---
name: programmatic-seo
description: Plan and build template-driven pages at scale from structured data (locations, integrations, comparisons, glossaries) without thin or duplicate content - data model, templates, quality gates, indexation control. Use for "programmatic SEO", "pSEO", "generate pages for every X".
---

# Programmatic SEO

## When to use
- The user has (or can get) a dataset where each row deserves its own page: cities, integrations,
  templates, product combinations, terms, alternatives.
- There is a repeatable search pattern like "<thing> in <place>", "<tool> + <tool> integration",
  "<product> alternatives".

Not for: a handful of hand-written pages, or when the only "data" is a keyword list with nothing unique
to say about each keyword. In that case recommend fewer, better pages instead.

## The core test
A programmatic page earns indexing only if it contains information the searcher wants that differs
meaningfully from its sibling pages. Swapping a city name into the same paragraph fails. Before
building, write down for one sample row: "what would a visitor learn here that they would not learn on
the neighbouring page?" If the answer is "nothing", stop and say so.

## Gather first
- The query pattern and evidence of demand (search data if available, or autocomplete and existing
  results as a proxy; say which).
- The data source: where it lives, how it is refreshed, its completeness per row, and licensing. Do not
  scrape sources whose terms forbid it.
- The stack: how routes are generated (static generation, SSR, prerender) and how sitemaps are built.

## Procedure

### 1. Model the data
- Define the entity and its fields. Mark which fields are unique per row (prices, counts, specs, local
  details, user reviews, real examples) versus shared boilerplate.
- Measure field coverage. Rows missing the unique fields are candidates for exclusion, not for filler.

### 2. Design the template
- Lead with the row-specific answer to the query, not a generic intro.
- Build sections from data: tables, lists, comparisons, maps, related items. Generated prose should be
  driven by actual values ("3 providers, cheapest from ...") rather than spun synonyms.
- Include links to parent hub pages and to genuinely related siblings (same region, same category).
- Unique title, H1, meta description and canonical from fields, with fallbacks for long values.
- Use AI-generated text only to describe real data, and review samples by hand; never to invent facts.

### 3. Set quality gates
Decide in code, per row, whether a page is indexable. Typical gates:
- minimum count of populated unique fields,
- minimum amount of row-specific content (as a threshold you choose and justify, not a magic number),
- no near-duplicate of another row (compare normalised content or key fields),
- data freshness within a defined window.
Rows that fail get `noindex` and are left out of the sitemap, or are not generated at all. Make the
threshold a named constant with a comment explaining it.

### 4. Control indexation
- Sitemap contains only rows that pass the gate; split large sitemaps and use an index file.
- Canonicals self-reference on passing pages; collapse true duplicates to one canonical.
- Handle empty, merged, or removed rows: 301 to the closest parent, or 404/410. Never leave stale pages
  returning 200 with empty data.
- Roll out in batches. Publish a subset, watch how many get indexed and whether they attract
  impressions, then expand. A mass launch of weak pages can drag down the whole site.

### 5. Build hubs
Create category and region hub pages that link to the leaves. These help discovery and often rank for
the broader term themselves.

### 6. Verify
- Generate the pages locally and inspect a random sample plus the extremes (row with the most data,
  row with the least).
- Check raw HTML contains content and metadata (not client-rendered only).
- Run a duplicate check across generated titles and descriptions.
- Validate the sitemap: every listed URL returns 200, is indexable, and self-canonical.
- Add a test that fails the build when a page below the quality gate becomes indexable.

## Pitfalls
- Doorway pages: many near-identical pages funnelling to one destination.
- Combinatorial explosion (every filter x every location) with no demand behind most combinations.
- Letting the template drift so one bug ships to thousands of URLs; test the template, not just a page.
- Forgetting maintenance: data goes stale and pages must be updated or retired.

## Deliver
Lead with go / no-go and why. Then: target pattern, data model with coverage stats, template outline,
the quality gate and how many rows pass it, indexation plan, rollout batches, and the metrics to watch
(indexed count, impressions, clicks per page). State which numbers you measured and which are
estimates. Confirm before publishing pages to production.
