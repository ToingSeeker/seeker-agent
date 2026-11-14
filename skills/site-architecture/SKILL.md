---
name: site-architecture
description: Design or restructure a site's page hierarchy, navigation, URL structure, and internal linking so users and crawlers reach important pages easily. Use for "site structure", "information architecture", "URL structure", "internal linking", "navigation redesign", "orphan pages".
---

# Site Architecture

## When to use
- Planning a new site or a major section, or restructuring one that grew messily.
- Important pages are buried, orphaned, or competing with each other.
- Changing URLs, merging sections, or planning a migration.

Not for: page-level copy (copywriting) or deciding which topics to cover (content-strategy), though
architecture should reflect the topic clusters that strategy produces.

## Gather first
- The site's goals and its main audiences: what each audience comes to do.
- The current page inventory. From a codebase, list routes and content files; from a live site, read
  the sitemap and crawl links from the home page. Record depth (clicks from home) and inbound internal
  link count per page.
- Traffic and conversion data per page if the user has it; otherwise ask which pages matter most.
- Constraints: CMS limits, URLs that must not change, multiple languages.

## Procedure

### 1. Define the hierarchy
- Group pages by what users are trying to do and by topic, not by internal org chart.
- Keep the tree shallow: important pages reachable in a few clicks from home. Depth is a rule of
  thumb, not a law; prioritise by importance.
- Each group gets a hub page that genuinely summarises and routes to its children. A hub that helps a
  visitor choose beats a bare list of links.
- Give each topic one home. Two pages targeting the same intent should be merged or clearly
  differentiated.

### 2. Design URLs
- Readable, lowercase, hyphenated, stable. Encode the hierarchy in the path only where it is stable; a
  category in the path makes moving items later expensive.
- No dates, IDs, or session parameters in indexable URLs unless they are essential.
- One trailing-slash policy and one host, enforced with 301s.
- Keep filters and sorting as parameters handled by canonical or noindex rules, unless a filtered view
  has real search demand of its own.

### 3. Plan navigation
- Primary nav: the few destinations most visitors need. Resist putting everything there.
- Footer: secondary and trust pages (about, contact, legal, support).
- Breadcrumbs on anything deeper than the second level, matching the hierarchy, with `BreadcrumbList`
  structured data.
- Navigation must be real anchor links with `href` in the rendered HTML, not click handlers.

### 4. Design internal linking
- Hub to spokes: every hub links to all its children.
- Spokes to hub: every child links back up.
- Spoke to spoke: link related siblings in body text where it helps the reader.
- Anchor text describes the destination; vary it naturally; avoid "click here".
- Link to the canonical URL directly, never through redirects.
- Find orphans (no internal links in) and either link them from the right hub or retire them.
- Surface priority pages: if a commercial page has few inbound links, add contextual links from
  relevant high-traffic pages.

### 5. Plan the change safely
- Build a redirect map: every old URL to its single best new URL with a 301, straight to the final
  destination with no chains.
- Update internal links to new URLs rather than relying on redirects.
- Update sitemaps, canonicals, hreflang, and structured data in the same release.
- Keep the map in the repo and test it: request each old URL and assert one 301 to the expected target.

### 6. Verify
Crawl the result (a small script that follows internal links from home, or a crawler if installed) and
report depth per page, orphans, broken links, redirect chains, and pages reachable only via the
sitemap. Compare with the pre-change crawl.

## Pitfalls
- Moving URLs that already rank well without a strong reason. URL changes have real cost.
- Mega-menus linking to hundreds of pages and diluting everything.
- Hubs created for search engines with no value to a visitor.
- Faceted navigation generating near-infinite crawlable URL combinations.
- JavaScript-only navigation that crawlers cannot follow.

## Deliver
Lead with the proposed structure as an indented tree with URLs. Then: navigation plan, internal linking
rules, merges and retirements, the redirect map, and crawl stats before vs after (or note that "after"
is not yet available). State which data you measured and which priorities came from the user. Confirm
before shipping URL changes or redirects to production.
