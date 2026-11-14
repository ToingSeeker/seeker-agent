---
name: generative-media-prompts
description: Write and iterate prompts for image and video generation models: subject, composition, camera, lighting, style, motion, and negative constraints, adapted to the model's syntax. Use for "write an image prompt", "prompt for video generation", "improve this AI image", "consistent character prompts".
---

# Generative Media Prompts

A good prompt is a precise brief: what is in the frame, how it is framed, how it is lit, what it looks like, and (for video) how it moves. Models differ, so the procedure is to write a structured brief, adapt it to the model, generate, look, and change one thing at a time.

## When to use

- Writing prompts for text-to-image, image-to-image, text-to-video or image-to-video models.
- Improving prompts that give generic, wrong or inconsistent results.
- Keeping a character, product or style consistent across many generations.

## Gather first

1. **Purpose and placement**: hero image, ad, storyboard frame, social clip. This sets aspect ratio, resolution and how much empty space is needed for text.
2. **The model**: different models prefer natural sentences, tag lists, or specific parameters; some support negative prompts, seeds, reference images, or style strength. Read the model's own documentation if unsure.
3. **References**: brand palette, mood images, product photos, an existing character sheet.
4. **Constraints**: no real people's likenesses without consent, no trademarks or copyrighted characters, no living artist's name as a style shortcut, the platform's content policy.

## Prompt anatomy

Write each part deliberately; leave out what does not matter.
- **Subject**: who or what, with concrete physical details (materials, colours, age range, clothing, expression). Specific nouns beat adjectives.
- **Action / state**: what the subject is doing.
- **Setting**: place, time of day, weather, era.
- **Composition**: shot size (close-up, medium, wide), angle (eye level, low, overhead), placement in frame, negative space for text, aspect ratio.
- **Camera and lens** (for photographic looks): focal length feel (wide, normal, telephoto), depth of field, film or digital character.
- **Lighting**: direction, quality (hard, soft, diffused), colour temperature, key sources (window light, neon, golden hour).
- **Style and medium**: photograph, 3D render, watercolour, flat vector illustration, and a few descriptive style words rather than names of artists.
- **Colour palette**: named colours or brand hexes as descriptions.
- **Motion (video)**: subject movement, camera movement (static, slow push-in, pan, orbit, handheld), speed, duration; one primary movement per shot works best.
- **Negative constraints**: things to exclude (text, watermarks, extra fingers, clutter), via the model's negative field if it has one, otherwise phrased positively ("plain background").

Order matters in many models: put the most important elements first.

## Procedure

1. Write a plain-language brief of the image or shot in two or three sentences.
2. Expand it with the anatomy above into a structured prompt.
3. Adapt to the model: sentences or comma-separated tags, its parameter syntax, its length sweet spot.
4. Generate a small batch (if you have access to a generation tool; otherwise hand the prompts to the user). Fix the seed where supported so changes can be compared.
5. Review the results against the brief: subject correct, composition, lighting, style, artefacts (hands, text, faces, physics in video).
6. Change one variable per iteration and note what it did. Keep a short log of prompt, seed, settings and outcome.
7. For consistency across a series: reuse a fixed descriptive block for the character or product, use reference images or character features where the model supports them, keep lighting and palette wording identical, and vary only the action and setting.
8. For video: generate or choose a strong first frame first, then describe motion relative to it; keep clips short and plan the edit in `video-production`.

## Quality bar

- Someone reading the prompt could sketch the frame.
- No contradictory instructions (e.g. "minimal" and "highly detailed busy scene").
- The output fits its placement: right aspect ratio, space for text where needed.
- Artefacts checked at full size, not only as thumbnails.

## Pitfalls

- Stacking quality buzzwords instead of describing the scene.
- Asking for legible text inside images from models that render text poorly; add text afterwards in layout instead.
- Too many subjects or actions in one shot.
- Using a real person's name, brand logo or copyrighted character.
- Treating a single lucky output as a reproducible result.

## Deliver

Give the final prompt(s) in copyable blocks, with model, settings and seed. Summarise what changed across iterations and why. If you generated images, show or link them and say which you inspected at full size. Flag any rights or policy concerns for the user to decide.
