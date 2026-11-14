---
name: social-graphics
description: Create banners, social posts, ad creatives, thumbnails and hero images in code (HTML/SVG/canvas rendered to PNG) with correct sizes per platform, clear hierarchy, safe zones and export. Use for "make a banner", "Instagram post", "OG image", "resize for social", "ad creative", "YouTube thumbnail".
---

# Social Graphics

Produce static marketing visuals that read in a fraction of a second on a small screen, in the exact sizes each placement needs.

## When to use

- Social posts, stories, cover images, link previews (Open Graph), ad creatives, thumbnails, web hero banners.
- Resizing one design into a set of formats.

For AI-generated imagery, write the prompt with `generative-media-prompts`; this skill handles layout, text and export around it.

## Gather first

1. Placement(s) and therefore sizes. Platforms change specs; check current official guidance with a web search if accuracy matters, and treat the figures below as common starting points, not guarantees.
2. The single message, the call to action, and any required elements (logo, price, legal line).
3. Brand assets: colours, fonts, logo files (prefer SVG), photography. Confirm image rights; do not use images you cannot license.
4. Output: PNG or JPG, any file-size limits, whether text must be editable later.

## Common sizes (verify before final export)

- Square feed post: 1080×1080. Portrait feed post: 1080×1350.
- Vertical story/reel/short cover: 1080×1920; keep text away from the top and bottom ~250 px where interface overlays sit.
- Link preview (Open Graph / social card): 1200×630.
- Video thumbnail (landscape): 1280×720.
- Wide header/cover banners vary by platform and crop differently on mobile; keep critical content centred.
- Web hero: design at the largest breakpoint and supply responsive crops, not one stretched image.

## Procedure

### 1. Hierarchy first
Decide the read order: one focal visual, one headline (short, a few words), optional supporting line, then CTA or logo. If you need more than that, the graphic is trying to do too much; move the rest into the caption.

### 2. Build in code
A reliable, tool-free approach: write an HTML page (or SVG) sized exactly to the canvas, using real fonts and brand colours, then render it to PNG with a headless browser (e.g. Playwright or Puppeteer, if installed) at device scale 2 for crispness, or with an SVG rasteriser. For batches, template the HTML and drive it from a small JSON of variants. Python with Pillow also works for simple layouts.

### 3. Layout rules of thumb
- Generous margins; a safe zone of roughly 5–10% on every edge, more where platform UI overlays.
- Text large enough to read at thumbnail size: render the image at ~25% scale and check.
- Strong contrast between text and background; over photos, use a scrim, a solid panel or an area of calm in the image.
- Limit to two type styles and the brand palette.
- Align to a grid; one focal point.
- Logo small and consistent in position across a set.

### 4. Adapt across formats
Do not scale one layout uniformly. Re-compose per aspect ratio: stack elements for portrait, place side by side for landscape, and re-check crops of the main image so faces and products stay in frame.

### 5. Export and check
- Exact pixel dimensions; sRGB; PNG for flat graphics and text, JPG or WebP for photos within size limits.
- Open each output and look at it (and at reduced size). Check spelling, numbers, dates and prices against the source.
- Name files predictably: `campaign_placement_WxH_variant.png`.
- Add alt text for each image for when it is posted.

## Pitfalls

- Too much text; tiny legal lines that become illegible.
- Content in areas covered by platform UI or circular avatar crops.
- Blurry exports from rendering at 1x and upscaling.
- Fonts silently falling back because they were not loaded before render (wait for fonts to load).
- Using copyrighted images, logos or likenesses without permission.

## Deliver

Lead with the list of output files and their sizes. Note the sources of all imagery and fonts, which specs you verified against current documentation and which you assumed, and anything awaiting the user's approval. Do not post or publish anything; publishing is the user's call.
