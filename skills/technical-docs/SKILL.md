---
name: technical-docs
description: Write or update technical docs from the actual code - README, API reference, runbook, release notes, onboarding guide - and run every command shown. Use for "write docs for", "document this", "update the README", "write a runbook", "release notes", "docs are out of date".
---

# Technical documentation from the code

## When to use
Use this when someone needs a README, an API reference, an operational runbook, release notes, a setup or onboarding guide, or an audit of docs that may have drifted from the code. Don't use it for marketing copy or end-user help-centre articles. Those need a different voice. For a product spec of something not yet built, use `spec-writing`.

## Gather first
- **Who reads it, and what are they trying to do?** A new contributor setting up, an on-call engineer at 3 a.m., an API consumer, a user upgrading. One document serves one primary reader.
- **The source of truth.** Entry points, CLI definitions, route handlers, config loaders, env var reads, package manifests, CI files, migrations. The code wins over old docs every time.
- **Existing docs and conventions.** Read what's there first: tone, heading style, where docs live, whether there's a docs site generator. Extend; don't fork a second style.
- **For release notes:** the tag or commit range, merged PRs, and anything marked breaking. Look at `git log <last-tag>..HEAD` and PR titles and bodies.

## Procedure
1. **Inventory what's real.** Search the code for how the thing is installed, configured, started, tested and deployed. List every env var the code reads (grep for `process.env`, `os.environ`, `getenv`, config schema files) with its default and whether it's required. List public commands, endpoints or exported functions.
2. **Diff against existing docs.** Note what's missing, what's wrong (renamed flags, removed endpoints, changed defaults) and what's documented but no longer exists. Stale docs are worse than none, because readers trust them.
3. **Outline for the reader's task, not the code's structure.** A README answers what it is, how to get running, how to do the common things, and where to go next. A runbook is organised by symptom or alert, then diagnosis, then action, then how to confirm recovery. An API reference goes per operation: purpose, parameters with types and constraints, response shape, errors, and a minimal example.
4. **Write.** Use short sentences and imperative steps, with one action per numbered step. Put prerequisites before the steps that need them. Copy-pasteable command blocks, with no prompt characters inside them. Put placeholders in an obvious form like `<your-token>`, and say where to get the real value.
5. **Verify every command and example.** Run them in a clean-ish environment: a fresh clone in a temp directory, or a scratch container if available. Run the install, the start command, the test command and the example API calls. If a command can't be run safely (it deploys, sends mail or costs money), don't run it. Mark it as unverified in your report.
6. **Check the links and references.** Relative links resolve, anchors exist, and the code paths you mention still exist.
7. **For release notes:** group changes into breaking changes (with migration steps), new features, fixes, and internal changes (often omitted for external readers). Write from the user's point of view ("Exports now include timezone"), not the commit's ("refactor tz util"). Every breaking change needs a "what you must do" line.

## Quality bar
- A newcomer can go from clone to running using only the doc.
- No secrets, internal hostnames or personal data in examples.
- Version-sensitive facts (runtime version, minimum OS) match the manifest files.
- Each runbook step says how to tell it worked.
- Prefer one accurate short page to a long speculative one. Don't document planned features as if they exist.

## Pitfalls
- Documenting what the code *should* do. Read it, and run it.
- Duplicating the same instructions in three files, which then drift apart. Link to one canonical place.
- Generated API docs with no examples. Add at least one realistic request and response per resource.
- Writing release notes from commit subjects alone. Read the PRs, because subjects are often misleading.
- Silently "fixing" docs to match a behaviour that is actually a bug. Flag it to the user instead.

## Report
Lead with which files were created or changed. Then list the commands and examples you executed and their results, anything you could not verify and why, and discrepancies you found between code and the old docs, especially any that look like bugs rather than doc errors.
