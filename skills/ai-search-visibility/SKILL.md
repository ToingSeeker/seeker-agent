---
name: ai-search-visibility
description: Make a site's content easy for AI answer engines and LLM-powered search to find, understand, quote, and cite - direct answers, clear structure, entities, evidence, crawler access. Use for "AI SEO", "GEO", "show up in ChatGPT/Perplexity/AI Overviews", "get cited by AI".
---

# AI Search Visibility

## When to use
- The user wants their product, brand, or pages to be mentioned or cited in AI-generated answers.
- A page ranks in classic search but never appears in AI summaries.
- Writing or restructuring content that should work for both humans and answer engines.

Not for: core crawl/indexation problems (run seo-audit first; an engine cannot cite what it cannot
fetch) or structured-data implementation detail (schema-markup).

## Mental model
Answer engines retrieve passages, then synthesise. Content gets used when a passage:
1. can be fetched and parsed as text,
2. answers a specific question on its own, without needing the surrounding page,
3. is attributable to a clear entity, and
4. looks trustworthy: specific, current, sourced, consistent with other sources.
Optimise for being the best *passage*, not just the best page.

## Gather first
- The questions the user wants to be the answer to. Write them as real prompts a person would type
  ("best X for Y", "how do I Z", "X vs Y", "is X worth it").
- The pages that should answer them, and competitors who currently get cited.
- Whether there is any analytics showing referrals from AI assistants (optional).

## Procedure

### 1. Check access
- Read `robots.txt` and note rules for AI-related crawlers. Blocking them is a legitimate business
  choice; make sure the current state is deliberate and explain the trade-off to the user rather than
  changing it on your own.
- Confirm the key content exists in the raw HTML (`curl -s`), not only after client-side rendering.
- Check for paywalls, interstitials, or cookie walls that hide the text from a fetcher.
- Optionally add an `llms.txt` summary file if the user wants one; treat it as a low-cost experiment,
  not a known ranking factor.

### 2. Test the current state
Where web search is available, run the target questions and note who is cited and what form their
answer takes. If you cannot query AI assistants directly, say so and use classic search results plus
the competitor pages as a proxy. Never report "you are not cited" without having actually checked.

### 3. Restructure for extractable answers
For each target page:
- Put a direct answer in the first one or two sentences under a heading phrased like the question.
  Then elaborate.
- Keep sections self-contained: a passage should make sense if lifted alone. Repeat the subject noun
  instead of "it" or "this" at section starts.
- Use lists for steps, tables for comparisons, and short definitions for terms. These map cleanly to
  synthesised answers.
- Add a concise FAQ only for questions people really ask; avoid padding.
- State specifics: numbers with units, dates, versions, prices, limits, conditions. Vague claims are
  rarely quoted.

### 4. Strengthen entity clarity
- Name the organisation, product, and author consistently across the site and profiles.
- Have an about page and author pages that establish who is speaking and why they are credible.
- Add Organization, Product, Article, or FAQ structured data where accurate (see schema-markup).
- Make the product's category explicit ("X is a <category> for <audience>") so it can be matched to
  category questions.

### 5. Add evidence
- Cite primary sources, link to them, and include original data, examples, or methodology where you
  have it. Original information is what makes a page worth citing over a summary of it.
- Show "last updated" dates and actually keep the content current.
- Do not invent statistics, testimonials, or expert quotes. If the user has no data, recommend how to
  collect some.

### 6. Earn third-party corroboration
Engines lean on consensus. Suggest realistic off-site work: accurate listings in relevant directories,
comparison and review sites, documentation, community answers, and partner pages, all describing the
product consistently. Do not suggest fake reviews or astroturfing.

## Pitfalls
- Keyword stuffing or writing "for the bot"; it makes passages worse for synthesis too.
- Hiding the answer below a long intro or behind tabs that render client-side only.
- Treating any single tactic as guaranteed. Visibility in AI answers is volatile and partly opaque; set
  expectations accordingly.
- Comparison pages that omit the user's weaknesses. Balanced pages are more likely to be trusted and
  quoted.

## Deliver
Lead with the top three changes most likely to help. Then per page: target question, current answer
quality, the rewritten opening passage, structural changes, evidence to add, entity/schema changes.
List what you verified (fetched HTML, robots rules, observed citations) versus what you could not
check. Ask before editing robots rules or publishing changes.
