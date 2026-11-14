---
name: web-performance
description: Make a web app faster with evidence - baseline Core Web Vitals, bundle size, API latency and slow queries; find the real bottleneck; fix it; re-measure against the baseline. Use for "the site is slow", "improve page speed", "reduce bundle size", "slow endpoint", "LCP".
---

# Web performance

## When to use
Use this when a page, endpoint or build is slow, or before and after a change that might regress speed. The rule is measure, change one thing, measure again. Don't apply generic "best practices" without a measurement showing they matter here, and never report an improvement you didn't measure.

## Gather first
- **What "slow" means** to the user: initial load, interactions, a specific API call, a background job, or build time. Ask which page or flow, on which device or network.
- **The environment to measure.** Use a production build. Dev servers are unrepresentative. Prefer a local production build or a staging URL; measure production only read-only.
- **Available tooling**, e.g. Lighthouse or a headless browser with performance tracing, if installed; the bundler's stats or analyser output; the database's query-explain facility and slow-query log; plain `curl -w` timings as a universal fallback.

## Procedure
1. **Set a baseline.** For each target, record:
   - **Page load**: LCP, INP (or total blocking time as a lab proxy), CLS, TTFB, and the total JavaScript and CSS transferred.
   - **API**: latency at the median and a high percentile, over enough repeated requests to see the spread.
   - **Bundle**: the size of each chunk, minified and compressed.
   - **Queries**: execution time and plan.

   Run several times and use the median. Single runs are noisy. Write the numbers down with the commit and the conditions (device emulation, network throttling, cache warm or cold).
2. **Locate the bottleneck** before changing anything. Break the time down:
   - **Server time** (TTFB): slow handlers, N+1 queries, missing indexes, synchronous calls to third parties, no caching, cold starts.
   - **Network**: large payloads, uncompressed responses, no caching headers, request waterfalls, too many round trips, a far-away region.
   - **Main thread**: large JS parse and execute cost, heavy hydration, long tasks, expensive re-renders, layout thrashing.
   - **Rendering**: an LCP element that's late (lazy-loaded hero image, web-font blocking, client-only rendering), or layout shift from unsized media or late-injected content.
   - **Bundle**: one huge dependency, duplicate copies of a library, code for other routes pulled into the entry chunk, polyfills nobody needs.

   Use traces and profiles to find the biggest single contributor. Optimise that first.
3. **Fix the top item.** Typical remedies, applied only where the measurement points:
   - **Data**: add the index, batch the queries, paginate, cache with explicit invalidation.
   - **Delivery**: compress, set cache headers on hashed assets, preload the LCP resource, size and serve modern image formats.
   - **Code**: split by route, lazy-load below-the-fold or rarely used features, replace a heavy dependency, move work off the main thread or out of the request path.
   - **Rendering**: reserve space for media and embeds, render critical content on the server.
4. **Re-measure** under identical conditions. Compare against the baseline and keep the change only if it helps beyond the noise. Check that you didn't regress something else: functionality, other pages, memory, cache correctness.
5. **Repeat** for the next bottleneck while the gains justify the effort. Stop when the target is met or the returns become marginal, and say which.
6. **Guard against regression**, optionally: a bundle-size budget check, a performance test in CI, or a simple timing assertion on the critical endpoint.

## Pitfalls
- Measuring a dev build, or a warm cache when users hit a cold one.
- Optimising something that's a small fraction of total time.
- Lazy-loading the LCP image, which makes LCP worse.
- Adding a cache with no invalidation story. That trades a speed bug for a correctness bug.
- Memoising everything in a UI framework without a profile showing the re-render cost.
- Lab scores aren't field data. Note the gap when real-user metrics are unavailable.

## Report
Lead with a before-and-after table for each target metric, giving the median of N runs and the conditions. Then give the bottleneck found and the evidence, the changes made, and the side effects checked. End with remaining opportunities ranked by expected impact and what couldn't be measured.
