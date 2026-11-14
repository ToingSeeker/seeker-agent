---
name: app-store-optimization
description: Improve an App Store / Google Play listing (title, subtitle, keyword field, descriptions, screenshots, video, icon, ratings, localisation) for search visibility and install conversion. Use for "ASO", "app store listing", "app keywords", "app screenshots", "more installs".
---

# App Store Optimization

## When to use
- Launching an app or a major update and preparing store listings.
- Installs are low despite impressions, or the app does not show up for relevant searches.

Not for: in-app conversion (paywall-upgrade, signup-onboarding), or review-guideline rejections, which
need the store's current guidelines read directly.

## Gather first
- Platforms (iOS, Android, both) and target countries/languages.
- Current listing text and assets. In a repo, look for store metadata folders (e.g. fastlane metadata
  directories) or ask the user to export them.
- What the app does, who it is for, and its real differentiators.
- Store console data if the user can share it: impressions, product page views, conversion rate, top
  search terms, ratings over time. Without it, say the work is based on judgement and competitor review.
- Main competitors the user's audience would also find.

## Platform facts to check
Field names, character limits, and which fields are indexed for search differ between the two stores and
change over time. Before writing, look up the current official limits and rules (via web search if
available) rather than relying on memory, and state which version you used. Broadly: Apple indexes the
title, subtitle, and a hidden keyword field; Google indexes the title, short description, and full
description.

## Procedure

### 1. Research search terms
- List the phrases a person would type to find an app like this: the problem, the category, the
  activity, and common alternate words.
- Check store search autocomplete and the competitors ranking for those terms.
- Favour terms that are relevant and attainable over the biggest generic term dominated by big brands.
- Do not use competitor brand names as keywords; it breaks store rules.

### 2. Write metadata
- **Title**: brand plus the most important descriptive phrase, if room allows. Readable, not stuffed.
- **Subtitle / short description**: the core benefit in plain words, adding terms not in the title.
- **Keyword field (iOS)**: comma-separated, no spaces after commas, no repeats of words already in the
  title or subtitle, singular forms usually suffice. Use the full allowance.
- **Full description**: the first lines show before "more", so lead with the benefit and who it is for.
  Then key features as short scannable lines, proof, and what is free vs paid. On Google Play, use
  important terms naturally in the text, without repetition for its own sake.
- Keep claims accurate; pricing and subscription terms must match the app.

### 3. Plan visual assets
- Screenshots: the first two or three are seen in search results, so each should state one benefit in
  a short caption over a real, readable screen. Order by what persuades, not by app navigation order.
- Show the app's actual UI; avoid mockups that misrepresent it.
- Preview video, if used: show the core action within the opening seconds, and make it work muted.
- Icon: simple, recognisable at small size, distinct from competitors' icons in search results.
- Produce assets at the required sizes for each device class; check the current requirements.

### 4. Ratings and reviews
- Ask for a rating with the platform's native prompt API, after a positive moment (task completed),
  not on launch or after an error. The platforms cap how often the prompt shows.
- Reply to reviews, especially negative ones with fixable issues; mention fixes in release notes.
- Never incentivise or fake reviews.

### 5. Localise
Translate and adapt metadata for priority markets, researching local search terms rather than
translating keywords literally. Localised screenshots help when text appears in them.

### 6. Test and iterate
Use the stores' built-in experiments (product page tests on iOS, store listing experiments on Google
Play) to test icons, screenshots, and short text one variable at a time. Change one thing per release
cycle where possible so effects can be attributed.

## Verification
- Count characters for every field against the current limits with a script, not by eye.
- Check for duplicated words across indexed iOS fields.
- Preview screenshots at actual phone size for legibility.
- Validate metadata files if a tool such as fastlane is installed (optional).

## Pitfalls
- Keyword stuffing in titles, which can get the app rejected and reads badly.
- Screenshots that are mostly marketing text with no visible app.
- Listing features the app does not have yet.
- Changing everything at once and not knowing what worked.

## Deliver
Lead with the recommended title and subtitle/short description per platform. Then the keyword set with
rationale, full description, screenshot plan with captions, rating-prompt placement, localisation
priorities, and the first experiment to run. Include character counts. State what came from store
data and what is judgement. Do not submit metadata or publish a release without the user's approval.
