---
name: video-production
description: Plan and produce short videos programmatically: script, shot list, assets, edit with ffmpeg or code-based compositions (e.g. Remotion), captions, audio, and export per platform. Use for "make a video", "explainer video", "promo clip", "add captions", "edit this footage", "render a reel".
---

# Video Production

Make short videos (explainers, product promos, social clips, demos) with tools that run from a terminal. The order matters: script, then plan, then assets, then edit, then captions and audio, then export and review.

## When to use

- A short video from a brief, footage, screenshots or a screen recording.
- Cutting, captioning, resizing or re-encoding existing video.
- Motion-graphics videos described in code.

## Gather first

1. Goal, audience and the one thing viewers should remember or do.
2. Target platform(s), aspect ratio(s) and length. Common: 16:9 for landscape players, 9:16 for vertical feeds, 1:1 or 4:5 for square feeds. Check current platform limits if precise specs matter.
3. Available material: footage, screen recordings, images, logos, music, voice-over, brand fonts and colours. Confirm rights for every asset, especially music.
4. Tooling present: run `ffmpeg -version`; check for Node (code-based compositions) or Python. Ask before installing anything sizeable.

## Procedure

### 1. Script
Write the narration or on-screen text in time-coded beats. For short social video, hook in the first couple of seconds, one idea per beat, end on the call to action. Read it aloud and time it; spoken English typically runs around 130–160 words per minute as a rule of thumb.

### 2. Shot list / storyboard
A table: beat, duration, visual (footage, screenshot, title card, animation), on-screen text, audio, transition. This is the edit decision list in plain form, and the user can approve it before rendering.

### 3. Prepare assets
- Normalise sources: same frame rate (pick one, e.g. 30 fps), resolution, and colour space. Convert variable-frame-rate screen recordings to constant frame rate first.
- Crop or reframe for each aspect ratio, keeping subjects in frame.
- Keep originals untouched; write intermediates to a working folder.

### 4. Edit

**ffmpeg** for cutting, concatenation, scaling, overlays, text, fades and audio mixing. Trim with accurate seeking (re-encode when cuts must be frame-exact), use the concat demuxer for same-format clips and the concat filter otherwise, and build complex edits with `-filter_complex`. Write the command into a script file so the edit is reproducible.

**Code-based compositions** (e.g. Remotion in React, or HTML/canvas frames rendered by a headless browser and stitched with ffmpeg) for motion graphics, animated titles, data-driven or templated videos. Drive everything from a frame counter so renders are deterministic. Check the licence terms of any framework before using it commercially.

### 5. Audio
- Voice-over clear and on top; music ducked under speech.
- Normalise loudness (ffmpeg's `loudnorm`; around -14 LUFS integrated is a common target for online platforms, but check the platform).
- No clipping; fade music in and out.

### 6. Captions
Most social video is watched muted, so captions are essential. Produce an SRT or VTT file from the script, or transcribe with a speech-to-text tool if one is installed (e.g. Whisper), then correct it by hand. Keep lines short (roughly two lines, ~40 characters each), timed to speech. Burn them in for social feeds; also keep the sidecar file for players that support it. Stay clear of platform UI zones in vertical video.

### 7. Export
- H.264 video, AAC audio in MP4, `yuv420p` pixel format and `+faststart` is the broadly compatible default. Use H.265/AV1 only if the destination supports them.
- Choose quality via CRF rather than fixed bitrate unless a size limit applies.
- One export per aspect ratio; name files clearly.
- Make a thumbnail or cover frame.

### 8. Review
Check the output with `ffprobe` (duration, resolution, fps, codecs, audio present). Extract frames at each beat and look at them. Watch or at least scrub the whole thing if possible; check caption sync at several points, the first and last second, and spelling.

## Pitfalls

- Mixed frame rates causing stutter or audio drift.
- Music without a licence.
- Text too small for phones; text under platform overlays.
- Re-encoding repeatedly and losing quality; keep a high-quality master.
- Fonts missing in headless render, silently falling back.

## Deliver

Lead with the output files (path, duration, resolution, size). Include the script, shot list and the reproducible render command or project. State what you checked (ffprobe, frames at which timestamps, full watch or not) and anything unverified, such as playback on the target platform or asset licences the user must confirm. Never upload or publish without the user's go-ahead.
