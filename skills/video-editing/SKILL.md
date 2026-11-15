---
name: video-editing
description: Edit existing video files with a bundled Python script on top of ffmpeg: trim, join, reframe to 9:16 or square, change speed, cut out silences, burn in captions or a title, fix or replace sound, add music, make a GIF, compress. Use for "cut this video", "remove the pauses", "add subtitles".
---

# Video Editing

Edit video files the user already has. The work is done by `scripts/vedit.py` in this skill's folder: one command per edit, each writing a new file and never changing the one it was given. For planning and producing a video from a brief (script, shot list, motion graphics), use the `video-production` skill instead.

## Before the first edit

1. Find the script: it is `scripts/vedit.py` inside this skill's folder (the folder is named when the skill is loaded). Use its absolute path. Run it with `python3`.
2. Check the tools once: `ffmpeg -version` and `python3 --version`. If ffmpeg is missing, say so and offer the install command (`brew install ffmpeg` on a Mac, `sudo apt install ffmpeg` on Debian or Ubuntu); do not install it without being asked.
3. Look at the source before deciding anything: `python3 <script> info <video>`. It prints the length, the picture size, the frame rate and whether there is sound.
4. Captions and titles are drawn with Pillow. If `python3 -c "import PIL"` fails, ask before running `pip install pillow`.

A path the user dragged in has spaces written as `\ `. Pass the plain path, in quotes.

## The edits

Every command prints one line of JSON. `"ok": true` comes with the output path, its duration, size and resolution; `"ok": false` comes with an `error` that says what to change. Read it; do not assume an edit worked.

| What the user wants | Command |
|---|---|
| Keep one part | `trim IN OUT --start 3 --end 12.5` (times in seconds or `m:ss`; `--copy` is instant but cuts only on a keyframe) |
| Join clips | `concat OUT A B C` (the first clip sets the frame size and rate; others are letterboxed to fit, silent clips get silence) |
| Vertical, square, wide | `reframe IN OUT --aspect 9:16` with `--mode crop` (fills the frame, cuts the sides; `--focus 0..1` chooses which part), `--mode blur` (whole picture over a blurred copy), or `--mode pad` (black bars) |
| Faster or slower | `speed IN OUT --factor 1.5` (sound stays in tune) |
| Remove pauses | `silence IN --report` first, then `silence IN OUT` (`--threshold -35` dB, `--min 0.5` s, `--pad 0.12` s left of each pause) |
| Subtitles | `captions IN OUT --srt FILE.srt` (`--position bottom\|middle\|top`, `--size 5` as a percentage of the shorter side, `--font PATH`) |
| A title or label | `text IN OUT --text "Chapter one" --start 0 --end 3` |
| Even loudness | `audio normalize IN OUT` (`--lufs -14`) |
| Sound only | `audio extract IN OUT.m4a` (or `.mp3`, `.wav`) |
| New soundtrack | `audio replace IN OUT --with SONG.mp3` |
| Music under speech | `audio mix IN OUT --music SONG.mp3 --duck` (`--music-volume 0.15`; the music loops and stops with the clip) |
| A GIF | `gif IN OUT.gif --start 2 --duration 4` (`--width 480 --fps 12`) |
| Smaller file | `compress IN OUT --max-mb 25`, or `--crf 23` for a quality target; `--height 720` also scales it down |
| Stills to look at | `frames IN FOLDER --at 1.5,4,9` |

Add `--dry-run` to see the ffmpeg command without running it, and `--force` to replace an output that exists.

## Procedure

1. **Understand the source.** Run `info`. A vertical phone clip, a screen recording and a camera file need different handling; say what you found in one line.
2. **Agree on the result** when the request leaves it open: which part, which shape, how long, where it will be posted. One short question, not a list.
3. **Order the edits** so each is done once: cut first (`trim`, `silence`), then shape (`reframe`), then sound (`audio normalize`, `audio mix`), then words (`captions`, `text`), then `compress` last. Each step reads the previous step's output; keep the intermediate files in a working folder beside the source and name the final file clearly.
4. **Captions need an .srt file.** If the user has none, write it from their script with times, or transcribe the sound if a speech-to-text tool is installed (for example `whisper FILE --output_format srt`); say that the text needs their check. Keep lines short: about two lines of 40 characters.
5. **Check the result before reporting it.** Compare the JSON with what was asked (duration after a trim, size after a reframe). Then extract frames with `frames` at the moments that matter — the first second, each caption, each cut — and look at them with `read_file`. A model that cannot see images must say that the picture was not looked at.
6. **Removing pauses is a judgement.** Run `--report` first and tell the user how much would go. If speech is being clipped, raise `--pad`; if breaths remain, raise `--threshold` towards -30.

## Pitfalls

- An output with the same name as the input is refused; so is overwriting without `--force`. Do not work around either by deleting the user's file.
- Repeated re-encoding loses quality. Plan the chain, and do not re-run a finished step to change something a later step controls.
- `--copy` on `trim` can start a moment early or late, on the nearest keyframe. Use it for rough cuts of long files, not for a cut that must be exact.
- `compress --max-mb` aims at the size and usually lands a little under it; check `size_mb` in the result when a hard limit applies.
- Music needs a licence. Do not add a track the user has not provided or named.
- With SEEKER's sandbox on, a result written outside the project is refused. Work on a copy inside the project, or ask the user to allow the folder (`/config sandboxWrite <folder>`).
- Text is drawn with the first system font found. If the result must match a brand, ask for the font file and pass `--font`.

## Deliver

Lead with the output file: its path, duration, resolution and size. Say which edits were made, in order, and what was checked (the JSON of each step, frames at which moments) and what was not — in particular whether anyone has watched it with sound. Remind the user to watch it before posting.
