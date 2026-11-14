---
name: presentations
description: Build a slide deck story-first, one idea per slide, as self-contained HTML or as .pptx via python-pptx when installed; render and check every slide. Use for "make a presentation", "slide deck", "pitch deck", "turn this into slides", "pptx".
---

# Presentations

A good deck is an argument with pictures. Write the story first, then make one slide per idea, then make it look consistent, then check every slide rendered.

## When to use

- Pitch decks, project updates, talks, training material, report summaries.
- Converting a document or data into slides.

## Gather first

1. **Audience and setting**: who, how much they already know, presented live or read alone. Read-alone decks need more text per slide than spoken ones.
2. **Goal**: what the audience should think or do at the end.
3. **Length**: minutes or slide count.
4. **Inputs**: source documents, data, brand template or colours, logos.
5. **Format**: HTML (portable, easy to version, opens in any browser) or `.pptx` (editable in presentation software). Check whether `python-pptx` is importable before promising pptx; if it is not, ask before installing anything.

## Procedure

### 1. Story outline
Write the headlines only, one per slide, as full sentences that state the point ("Churn halved after onboarding change"), not topics ("Churn"). Read them in order: they should form the argument on their own. A common shape is situation, problem, insight, proposal, evidence, ask. Get the user's agreement on this outline for anything substantial; it is cheap to change now.

### 2. Slide content
- One idea per slide. If a slide needs two headlines, split it.
- Support each headline with one thing: a chart, an image, a diagram, a short list, or a big number.
- Bullets: few, short, parallel. Detailed text goes in speaker notes.
- Charts: one message each, highlighted (colour the bar that matters, grey the rest), labelled directly, with source and date. Never invent data; mark placeholders clearly.

### 3. Visual system
- A fixed grid and margins; title in the same position on every slide.
- Two type sizes for body and title plus one for big numbers; brand palette with a single highlight colour.
- Consistent slide types: title, section divider, statement, chart, image, comparison, closing.
- Sufficient contrast for projectors (they wash out mid-tones).

### 4. Build

**HTML**: one file with a section per slide at a fixed 16:9 canvas (e.g. 1920×1080 scaled to the viewport), keyboard navigation with arrow keys, and print CSS that puts one slide per page so it can be saved as PDF. Embed or reference local assets; avoid runtime dependencies on external CDNs if the deck must work offline.

**pptx**: with python-pptx, start from the user's template if provided (use its layouts and placeholders rather than drawing free text boxes), set 16:9, put titles in title placeholders (good for accessibility and outline view), add speaker notes, and set alt text on images. Native charts keep data editable; images of charts are acceptable when styling matters more.

### 5. Render and check every slide
Render to images: open the HTML in a headless browser and screenshot each slide, or convert pptx to PDF with LibreOffice if installed and look at the pages. Check for overflow and clipped text, font fallback, alignment drift between slides, chart readability, and typos. Read the headlines in sequence once more.

## Quality bar

- Headlines alone tell the story.
- No slide with more than one point; no wall of text in a spoken deck.
- Every number has a source; nothing fabricated.
- Consistent layout from first slide to last.
- Readable from the back of a room: large type, high contrast.

## Pitfalls

- Starting in the slide tool before the story exists.
- Decorative stock images that say nothing.
- Shrinking font size to fit more text instead of splitting the slide.
- Animations that slow the presenter down.
- A pptx that looks right on one machine and breaks elsewhere because of uninstalled fonts; embed-safe fonts or note the requirement.

## Deliver

Lead with the file path and slide count, then the headline outline. State how you checked the output (rendered to images, which viewer) and anything you could not verify, such as fonts on the presenter's machine or data you could not source.
