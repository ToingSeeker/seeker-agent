---
name: video-editor
description: Expert editor for film, YouTube Shorts, Instagram Reels and TikTok - pacing, cut craft, colour, sound, captions, platform export - and rebuilding a reference video's edit (shot timing, beat sync, look, loudness) with your own footage. Use for "edit like a pro", "make it like this video".
---

# Video Editor (expert)

Edit like a working editor: decide what the piece is for, cut for emotion and rhythm, grade, mix, caption and
export to each platform's spec — and, when the user hands over a **reference video**, measure its edit and rebuild
it with their footage until the numbers match.

Tools, all from a terminal:
- `scripts/refcut.py` in this skill's folder (Python 3 + ffmpeg, nothing else): measure a reference, plan the
  rebuild, make a colour-matching LUT, render, and compare the result with the reference.
- The `video-editing` skill's `scripts/vedit.py` for everyday operations: trim, reframe, silence removal,
  captions and titles (drawn with Pillow), audio mixing, compression. Read that skill when you need them.
- Plain `ffmpeg` for the rest (recipes below). The `video-production` skill covers scripting and planning a
  video from a brief.

Check once: `ffmpeg -version`, `python3 --version`. Find which text filters this ffmpeg has:
`ffmpeg -hide_banner -filters | grep -E " (subtitles|drawtext) "` — many builds (Homebrew's included) have
neither, so burn text with `vedit.py captions` / `text` instead. Optional helpers, only with the user's OK to
install: `faster-whisper` (word-level timestamps for karaoke captions), `scenedetect` (PySceneDetect),
`librosa`, `opencv-python` (motion/zoom estimation).

## Gather first (one short message, not a questionnaire)
- **Where it will run** — film/YouTube long-form, Shorts, Reels, TikTok (or several: one master, several exports).
- **The material** — footage, voice-over, music, logo, fonts, and a reference if they have one. Run
  `python3 <vedit.py> info <file>` on each source and say in one line what you found (vertical phone clip,
  LOG camera file, VFR screen recording...).
- **The one thing** the viewer should feel, learn or do. It decides every cut.
- **Rights** — music and any third-party clip. Never add a track the user has not provided or named.

## The craft (what makes an edit good)

**Murch's Rule of Six** — a cut should serve, in order of weight: emotion 51%, story 23%, rhythm 10%, eye-trace
7%, the 2D plane of the screen 5%, 3D space 4%. When they conflict, give up from the bottom; never give up
emotion for continuity. (Eye-trace matters more on a phone, where the frame is small and the viewer scrolls.)

**Cuts and when to use them**
- *Cut on action* — mid-movement, so motion hides the edit. The default invisible cut.
- *J-cut / L-cut* — next shot's sound starts early / this shot's sound runs on. Dialogue and smooth transitions.
- *Match cut* — shape, motion or sound rhymes across the cut. Transitions with meaning.
- *Jump cut* — same framing, time skipped. Vlog/talking-head standard; punch in 110–120% on alternate cuts so it
  reads as deliberate.
- *Smash cut* — abrupt switch at peak intensity (loud→silent). Comedy, shock.
- *Cutaway / B-roll* — covers a jump in an interview and shows what is being said.
- *Cross-cut* — alternate two simultaneous lines of action to build tension.
- Continuity: stay on one side of the 180° line, match eyelines and screen direction.

**Pacing — measure, don't assume.** Mainstream film shots now average about 3–5 s (Bordwell); by genre (Follows,
1997–2016): action ≈4.0 s, adventure ≈5.1 s, sci-fi ≈6.2 s, drama ≈14.8 s. No credible published norm exists for
TikTok/Reels shot length, so take it from the reference or the user's best-performing videos. Report median and
spread, not just the mean: a good edit varies rhythm — fast through action, held on emotion.

**Short-form structure** (TikTok's own creative data: over 63% of its highest-CTR videos land the key message in
the first 3 s; treat the rest as practitioner heuristics):
1. **Hook in 0–3 s** — the payoff, the problem or a pattern break on frame one. No logo intros, no "hi guys".
2. **One idea per beat**, a visual or audio change every few seconds (cut, punch-in, B-roll, text, SFX).
3. **Hold the payoff** until the end; keep promises the hook made.
4. **Loop or CTA** — last line/frame flows into the first (rewatches), or a CTA in the last 1–3 s, inside the
   safe zone.
5. **Captions on** — most feeds start muted. Bold sans-serif, 1–5 words per line, white with black stroke,
   word-by-word highlight ("karaoke") is the current dominant style (retention-lift numbers come from caption-tool
   vendors, not independent studies).

## Platform specs (verify before relying on a limit; platforms change them)

| | YouTube Shorts | Instagram Reels | TikTok | Film / YouTube long-form |
|---|---|---|---|---|
| Frame | 1080×1920 9:16 | 1080×1920 9:16 (grid shows centre 3:4) | 1080×1920 9:16 | 3840×2160 / 1920×1080; scope 2.39:1 letterboxed |
| Length | ≤3 min (from 15 Oct 2024); Content-ID-claimed Shorts >1 min are blocked | ≤3 min recommended to new viewers (Jan 2025) | uploads up to 10 min+ (sources conflict: 30–60 min) | any |
| fps | 24–60 | ≥30 | 30 (≤60) | native: 23.976/24/25/29.97 |
| Video | H.264 High, 4:2:0, BT.709 | H.264 High, 4:2:0 | H.264 (no published bitrate) | mezzanine ProRes 422 HQ / DNxHR HQX; web master H.264 |
| Audio | AAC 48 kHz | AAC 48 kHz stereo | AAC | — |
| Loudness | ≈ −14 LUFS (observed, turned down only) | no published target; −14 LUFS / −1 dBTP is common | same | EBU R128 −23 LUFS / −1 dBTP; ATSC −24 LKFS; Netflix −27 LKFS dialogue-gated |

**Safe zones on 1080×1920** (no platform publishes these as numbers; third-party measurements of the UI overlays):
- Shorts: top ~288 px, bottom ~672 px, right ~192 px are covered.
- Reels: top ~220–270, bottom ~340–670, sides ~65–130.
- TikTok: top ~160, bottom ~440, right ~80+ (the icon rail).
- **Rule for all three:** keep text and faces inside x 120–900, y 290–1250; captions around y 1150–1300.
  `vedit.py captions --position middle` lands there; check a still.

## Colour

Order: (1) convert LOG to Rec.709 with the camera's LUT, (2) correct — exposure, white balance, contrast, (3) match
shots to each other, (4) creative look, (5) output. Read `signalstats` (YAVG, SATAVG) or the waveform/vectorscope
(`ffmpeg -i x -vf "waveform,scale=640:-2" -frames:v 1 w.png`); skin of every complexion sits near the vectorscope's
skin line (~123°).

ffmpeg building blocks: `lut3d=file=look.cube` (camera or creative LUT), `eq=contrast=1.1:saturation=0.85:gamma=1.0`,
`curves=master='0/0.05 0.25/0.2 0.75/0.8 1/0.95'` (filmic S with lifted blacks),
`colorbalance=rs=-0.1:bs=0.1:rh=0.08:bh=-0.08` (teal shadows / warm highlights), `colortemperature=temperature=5600`.
Stack them in one `-vf` chain in one encode.

## Sound

Dialogue first and intelligible, music ducked under it (`vedit.py audio mix --duck`), no clipping, music faded in and
out. Normalise last, two-pass for accuracy: run `loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, then feed the
measured values back (`measured_I`, `measured_TP`, `measured_LRA`, `measured_thresh`, `offset`). Use the target
from the table above. SFX (whoosh on transitions, hit on a punch-in) only from the user's library or a licensed pack.

## Recreating a reference video ("make it exactly like this")

**What "exactly" can mean.** The edit's *structure and style* — shot timing, rhythm, beat sync, pacing curve,
colour look, loudness, caption style, zooms — are ideas and methods, which copyright does not protect (US 17 U.S.C.
§102(b)), so they can be reproduced closely. The reference's *footage, music recording, voice, script text and
distinctive graphics* are protected, and platforms down-rank reposts. So rebuild with the user's own footage,
licensed music (ideally at the same tempo), and their own words. Never put the reference's own media into the
output; if asked to, say why and offer the rebuild. A shot-for-shot clone of a recognisable creative piece still
carries risk — say so plainly.

**1. Measure it.**
```
python3 <refcut.py> analyze ref.mp4 --out ref.json --stills ref-shots/
```
The summary line gives shots, ASL, cuts per minute, first cut (the hook), look in words, LUFS, tempo and the share of
cuts on a beat. `ref.json` holds every shot (start, end, duration, motion, brightness, still), the pacing curve
(cuts per 5 s), the look (Lab means and spreads, palette, letterbox), loudness, beats and onsets, fades to black.
- If the shot count looks wrong, re-run with `--threshold`: lower (0.15–0.2) for soft cuts and talking-head jump
  cuts, which a scene detector often misses; higher (0.4) if camera moves or flashes create false cuts. Merged
  dissolves show up as one long shot — check the stills.
- `cuts_on_beat` near 1.0 means the edit is beat-synced; keep that in the rebuild.

**2. Look at what the numbers can't see.** Open the stills (`read_file` on each, or a contact sheet:
`ffmpeg -i ref.mp4 -vf "fps=1,scale=240:-2,tile=6x4" -frames:v 1 sheet.png`) and write a style sheet:
shot types (wide/medium/close), on-screen text (words, font look, size, position, colour, when it pops), caption
style, punch-ins and camera moves, speed ramps, transitions, SFX moments. A model that cannot see images must say
so and ask the user to describe the shots.

**3. Plan the rebuild.**
```
python3 <refcut.py> plan ref.json plan.json --footage a.mp4 b.mp4 c.mov [--music track.mp3 --snap beats] \
    [--keep-audio] [--aspect 9:16] [--duration 30] [--lut look.cube]
```
Each segment carries the reference shot it replaces (`ref.start/end/motion/still`) and a first-guess `src`/`in`.
**The guess is only round-robin — now edit it like an editor:** look at stills of the footage
(`vedit.py frames`), and for each segment pick the clip and in-point whose content plays the same role as the
reference shot (wide where it is wide, the action peak where it cuts on action, a face where it holds on a face).
Keep `duration` to keep the rhythm. Set `speed` (e.g. 0.5 for slow motion, 2 for a ramp-up section) where the
reference ramps. `--snap beats` moves cuts onto your music's beats (within `--tolerance`, 0.15 s). With
`--keep-audio` the footage's own sound (speech) is kept and music sits under it.

**4. Match the look.**
```
python3 <refcut.py> lut ref.json look.cube --from a.mp4 b.mp4 --strength 0.8
```
It measures your footage and writes a 33³ `.cube` LUT that moves its colour statistics to the reference's (Reinhard
transfer in Lab, spread ratios clamped so flat footage isn't torn apart). It reports ΔE before. Correct exposure
and white balance first; convert LOG first. Mixed-lighting footage may need one LUT per clip group (separate plans
or a manual `lut3d` per clip).

**5. Render.** `python3 <refcut.py> render plan.json draft.mp4` — every segment is scaled to fill and centre-cropped,
set to the plan's fps, given the LUT, and cut to an exact frame count; sound is joined sample-exact, then
loudness-normalised to the plan's target. Then add what the script doesn't do, each as one more pass on the draft:
- **Captions / text** to the style sheet: `vedit.py captions` with an SRT (word-level timestamps from
  `faster-whisper` with `word_timestamps=True` give karaoke timing: one cue per word or short phrase).
- **Punch-ins:** a static 115% punch for a segment's time range:
  `-vf "crop=iw/1.15:ih/1.15,scale=1080:1920"` on that piece; a slow push:
  `zoompan=z='min(zoom+0.0015,1.15)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`.
- **Smooth slow motion** from normal footage: `minterpolate=fps=60` before slowing (slow to render; check
  for warping artefacts).

**6. Compare, then iterate.**
```
python3 <refcut.py> compare ref.json final.mp4
```
It reports duration, size, shot count, ASL, cut timing error (mean/worst seconds, share within 2 frames), look ΔE
(under ~3 is hard to tell apart; over 6 is visibly different), LUFS and tempo, and a `gaps` list. Fix each gap
and run it again. Cuts inside your own footage (a camera cut within a clip) add shots — trim around them. Then
compare by eye: the stills side by side with frames from the result at the same times.

## Export recipes

Shorts / Reels / TikTok master:
```
ffmpeg -i in.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -maxrate 16M -bufsize 32M -g 15 -bf 2 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 30 -c:a aac -b:a 256k -ar 48000 -movflags +faststart out.mp4
```
Film mezzanine: ProRes 422 HQ `-c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le`; DNxHR HQX
`-c:v dnxhd -profile:v dnxhr_hqx -pix_fmt yuv422p10le`; audio PCM 48 kHz. YouTube long-form: H.264 High with the
BT.709 tags above, `+faststart`, 48 kHz AAC. One export per aspect ratio, from the same master; cover frame with
`vedit.py frames`.

## Procedure (any edit)
1. Gather; inspect every source with `info`.
2. Structure first (story/hook), then rhythm, then picture polish, then sound, then text, then export. Plan the
   chain so each step re-encodes once; keep a high-quality master.
3. Verify each step's JSON, then look at frames at the hook, every cut that matters, every caption, and the last
   second. Listen if you can; if you cannot, say the sound was checked by numbers only (LUFS, peaks).

## Pitfalls
- Recreating a reference by reusing its footage, music or text — rebuild with the user's own.
- Trusting the detected shot count blindly: dissolves merge, jump cuts hide, flashes add. Check the stills.
- Grading before converting LOG; one LUT across clips shot in different light.
- Text in the platform UI zones; captions too small for a phone (aim ≥ ~5% of frame height per line).
- Mixing frame rates or VFR sources without converting — stutter and drift.
- Re-encoding the same footage over and over; normalising loudness before the final mix.
- Music without a licence; TikTok's Commercial Music Library licence covers TikTok only.
- Calling it "the same as the reference" when `compare` still lists gaps, or without having looked at it.

## Deliver
Lead with the output file(s): path, duration, resolution, fps, size, loudness. For a reference rebuild, quote the
`compare` result (shots, cut timing error, ΔE, LUFS) and the gaps left, if any. Say what was looked at (which
frames), what was only measured, and what was not checked (watching with sound, playback in the target app,
licences). Never upload or publish without the user's go-ahead.
