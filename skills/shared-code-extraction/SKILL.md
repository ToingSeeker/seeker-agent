---
name: shared-code-extraction
description: Find duplicated logic in recent work and extract a shared helper only where it pays off - real repetition, same reason to change, callers stay simpler. Use for "dedupe this", "extract a shared util", "too much copy-paste", "DRY this up", "should this be a library".
---

# Shared code extraction

## When to use
Use this after a burst of feature work, when similar code has appeared in several places, or when the user asks to deduplicate. The goal is fewer places to fix the next bug, not fewer lines. Don't use it to restructure a codebase wholesale or to build a framework. Skip it for code still in flux, where the shape will change next week.

## Gather first
- **The scope.** Usually the recent diff (`main...HEAD`, or the last N commits), plus the existing code it resembles. Ask if unclear.
- **The existing shared places.** `utils/`, `lib/`, `shared/`, `common/`, internal packages. A helper that already exists beats a new one.
- **How the project checks itself.** The test, typecheck and lint commands. You'll run them before and after.
- **Boundaries that forbid sharing.** Client vs server bundles, packages with separate release cycles, code that must not import from another layer.

## Procedure
1. **Find candidates.** Read the diff and search for repeated shapes: the same validation, the same fetch-retry-parse sequence, copy-pasted formatting, parallel switch statements, near-identical components. Search on distinctive identifiers, string literals and error messages, because copies keep them. A token-based duplicate detector (e.g. jscpd, PMD CPD, if installed) can help, but read every hit yourself.
2. **Judge each candidate.** Extract only when all of these hold:
   - It's repeated at least three times, or twice with a known bug that had to be fixed in both places.
   - The copies change for the **same reason**. Code that looks alike but serves different domain rules will diverge again, and a shared helper then sprouts flags.
   - A name exists that describes what it does, not where it came from. If you can only call it `handleStuff`, it isn't a concept yet.
   - The callers get simpler. If the helper needs four boolean options to cover the variants, leave the copies.
   - It doesn't cross a boundary the architecture forbids.
3. **Rank by payoff.** Put first the copies that touch money, auth, data integrity or parsing, where divergence is a bug. Put last the cosmetic duplication.
4. **Present the plan before editing** if more than a couple of files change. List each extraction, its call sites, the proposed name and location, and the ones you rejected and why. Let the user cut the list.
5. **Extract one at a time.** Write the helper and give it a focused test covering the behaviour of all the copies, including their differences. Migrate the callers one by one. Run the tests after each extraction, not only at the end.
6. **Reconcile differences deliberately.** If the copies disagree (one trims whitespace, one doesn't), find out which is right. Don't silently pick one. An unexplained difference may be a latent bug, or it may be intentional. Ask, or keep the behaviour explicit at the call site.
7. **Delete the dead copies** and any imports they leave behind.

## Quality bar
- Behaviour is unchanged unless a difference was consciously resolved, and that is recorded.
- The helper lives where its callers can import it without circular dependencies.
- The tests pass, and the typecheck shows no new errors compared with before.
- The net result is easier to read. A good extraction makes the diff look obvious.

## Pitfalls
- Premature abstraction is costlier than duplication. Two copies that look alike are not yet a pattern.
- Generic helpers with type parameters and option bags that only one caller uses.
- Mixing an extraction with a behaviour change in one commit. Keep them separate so a reviewer can verify "pure move".
- Breaking a public API or a package export while moving code.
- Identifiers and string literals that look like prose (slugs, event names, keys) get swept up in renames. Leave them alone.

## Report
Lead with what was extracted: each helper, its location, and how many call sites now use it. Then list the candidates you rejected and why, the behavioural differences you found and how each was resolved, and the test, typecheck and build results before and after.
