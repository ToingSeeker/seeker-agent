---
name: schema-markup
description: Add, fix, and validate JSON-LD structured data (Organization, Product, Article, FAQ, Breadcrumb, LocalBusiness, etc.) so it matches visible content and parses cleanly. Use for "add schema", "structured data", "JSON-LD", "rich results", "fix schema errors".
---

# Schema Markup

## When to use
- Adding structured data to page templates, or fixing errors/warnings reported by a validator or
  Search Console.
- Making entities (organisation, product, author, location) explicit for search and AI engines.

Not for: general SEO problems; structured data does not fix pages that are not indexed.

## Principles
- **JSON-LD** in a script element of type `application/ld+json` is the preferred format; keep it
  separate from presentation markup.
- **Mark up what is visible.** Every value should be present on the page for users. Hidden or
  contradictory markup (fake ratings, prices that differ from the page) risks manual action and loses
  trust.
- **Generate from the same data** that renders the page, never a hand-maintained copy that can drift.
- **Eligible is not guaranteed.** Valid markup makes a page eligible for rich results; the search engine
  decides whether to show them. Say this to the user.

## Gather first
- Page types on the site and what each represents.
- Where data comes from (CMS, database, props) and how pages render (SSR/static vs client only).
- Existing markup: search the code for `ld+json`, `itemprop`, and `schema.org`.

## Procedure

### 1. Map page types to schema types
Pick the most specific accurate type. Common pairings:
- Home / about: `Organization` (or a `LocalBusiness` subtype) plus `WebSite`.
- Blog post / guide: `Article` or `BlogPosting` with author `Person` and publisher.
- Product or plan page: `Product` with `Offer`; add `AggregateRating` only from real, on-page reviews.
- Software: `SoftwareApplication`.
- Step-by-step guides: `HowTo` only if the steps are really on the page.
- Any page in a hierarchy: `BreadcrumbList`.
- Events, recipes, jobs, courses, videos: their dedicated types.
Check current search-engine documentation for which types still produce rich results; support changes
over time, so do not rely on memory for that.

### 2. Link entities with @id
Give the organisation, website, and authors stable `@id` URLs (for example the site origin plus
`/#org`) and reference them from other nodes instead of repeating them. Use `@graph` to put related
nodes in one block. Add `sameAs` links to official profiles to disambiguate the entity.

### 3. Implement
- Build a small helper per type that takes the page's data and returns an object; serialise it with
  the language's JSON serialiser. Never concatenate JSON strings by hand.
- Escape the less-than character in the serialised output (as its unicode escape) so a string value
  can never close the surrounding script element early.
- Omit fields with no value instead of emitting empty strings or null.
- Use absolute URLs, ISO 8601 dates, ISO currency codes, and numeric prices without symbols.
- Render it server-side or at build time so it is in the raw HTML. Client-injected markup may be seen
  late or not at all.
- Avoid duplicates: one node per entity per page, not one from a plugin and another from a template.

### 4. Validate
- Fetch the raw HTML with `curl -s` and extract each JSON-LD block; confirm it parses as JSON
  (for example with `python3 -m json.tool` or a one-line node script).
- Check required and recommended properties for each type against the current documentation.
- If network access allows, run the page through a public validator (for example the Schema.org
  validator or a search engine's rich results test) and record the result.
- Cross-check values against the visible page: name, price, rating, dates, author.
- Add a test that renders a sample of each template and asserts the JSON-LD parses and contains the
  required keys.

## Pitfalls
- `FAQPage` stuffed with marketing questions nobody asks, or questions not visible on the page.
- Reviews or ratings written by the business about itself.
- `Organization` markup copied onto every page with different values.
- Stale prices or availability because markup is cached separately from page data.
- Markup that only appears after client-side hydration, so the raw HTML has none.

## Deliver
Lead with what was added or fixed and on which templates. Include a per-template list of types and
key properties, the validation output you actually ran, and anything left unverified (rich-result
eligibility needs a live URL). Show one example JSON-LD block. Do not deploy without approval.
