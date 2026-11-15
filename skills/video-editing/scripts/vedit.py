#!/usr/bin/env python3
"""vedit: everyday video edits from one command, on top of ffmpeg.

It needs ffmpeg and ffprobe on the PATH and Python 3.8 or newer. Burning captions or a title into
the picture also needs Pillow (`pip install pillow`). Nothing else.

Every edit writes a new file and never touches the one it was given. When it is done it prints one
line of JSON that says where the result is and what it is (duration, size, resolution), so the
caller can check it without opening it. `--dry-run` prints the ffmpeg command and runs nothing.

    vedit.py info clip.mp4
    vedit.py trim clip.mp4 out.mp4 --start 3 --end 12.5
    vedit.py concat out.mp4 a.mp4 b.mp4 c.mov
    vedit.py reframe clip.mp4 out.mp4 --aspect 9:16 --mode blur
    vedit.py speed clip.mp4 out.mp4 --factor 1.5
    vedit.py silence clip.mp4 out.mp4 --min 0.6
    vedit.py captions clip.mp4 out.mp4 --srt clip.srt
    vedit.py text clip.mp4 out.mp4 --text "Chapter one" --start 0 --end 3
    vedit.py audio normalize clip.mp4 out.mp4
    vedit.py audio mix clip.mp4 out.mp4 --music song.mp3 --duck
    vedit.py gif clip.mp4 out.gif --start 2 --duration 4
    vedit.py frames clip.mp4 shots/ --at 1.5,4,9
    vedit.py compress clip.mp4 out.mp4 --max-mb 25
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

VIDEO = ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"]
AUDIO = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
FAST_START = ["-movflags", "+faststart"]


class Problem(Exception):
    """Something the person asking can act on: said in one line, with no traceback."""


def need(program):
    if not shutil.which(program):
        raise Problem(f"{program} is not installed. On a Mac: brew install ffmpeg. On Debian or Ubuntu: sudo apt install ffmpeg.")


def run(command, dry=False, capture=False):
    if dry:
        print(" ".join(quote(c) for c in command))
        return ""
    done = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    if done.returncode != 0:
        tail = "\n".join(done.stderr.strip().splitlines()[-6:])
        raise Problem(f"ffmpeg could not do this:\n{tail}")
    return done.stderr if capture else done.stdout


def quote(text):
    return text if re.fullmatch(r"[\w@%+=:,./-]+", text) else "'" + text.replace("'", "'\\''") + "'"


def probe(path):
    """What a file is: duration, picture size, frame rate, and whether it has sound."""
    need("ffprobe")
    if not os.path.isfile(path):
        raise Problem(f"There is no file at {path}.")
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace",
    )
    if out.returncode != 0:
        raise Problem(f"{path} is not a video or audio file ffprobe can read.")
    data = json.loads(out.stdout or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    info = {"path": os.path.abspath(path), "duration": round(float(data.get("format", {}).get("duration") or 0), 3)}
    info["size_mb"] = round(os.path.getsize(path) / 1_000_000, 2)
    if video:
        width, height = int(video["width"]), int(video["height"])
        # A phone clip is often stored sideways with a note to turn it: what is seen is what counts.
        turn = abs(int(float(next((d.get("rotation", 0) for d in video.get("side_data_list", []) if "rotation" in d), 0))))
        if turn in (90, 270):
            width, height = height, width
        num, _, den = (video.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 0.0
        info.update({"width": width, "height": height, "fps": round(fps, 3), "video_codec": video.get("codec_name")})
    info["has_video"] = bool(video)
    info["has_audio"] = bool(audio)
    if audio:
        info["audio_codec"] = audio.get("codec_name")
    return info


def seconds(text):
    """12.5, 1:02.5 or 01:02:03.5 as seconds."""
    if text is None:
        return None
    try:
        parts = [float(p) for p in str(text).strip().split(":")]
    except ValueError:
        raise Problem(f'"{text}" is not a time. Use seconds (12.5) or h:m:s (1:02.5).')
    if not 1 <= len(parts) <= 3 or any(p < 0 for p in parts):
        raise Problem(f'"{text}" is not a time. Use seconds (12.5) or h:m:s (1:02.5).')
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return total


def even(number):
    return max(2, int(round(number / 2)) * 2)


def target(src, out, force):
    """Where the result goes. Never the source, and not over an existing file unless asked."""
    if src and os.path.abspath(src) == os.path.abspath(out):
        raise Problem("The output is the input file. Give the result a name of its own.")
    if os.path.exists(out) and not force:
        raise Problem(f"{out} already exists. Choose another name, or add --force to replace it.")
    folder = os.path.dirname(os.path.abspath(out))
    os.makedirs(folder, exist_ok=True)
    return out


def finish(out, dry, **extra):
    if dry:
        return
    report = {"ok": True, "output": os.path.abspath(out)}
    if os.path.isfile(out):
        info = probe(out)
        report.update({k: info[k] for k in ("duration", "width", "height", "fps", "size_mb", "has_audio") if k in info})
    report.update(extra)
    print(json.dumps(report))


def encode(inputs, filters, out, dry, maps=None, extra=None, audio=True):
    """One ffmpeg run that re-encodes to the format that plays everywhere."""
    need("ffmpeg")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs]
    if filters:
        command += ["-filter_complex", filters]
    for label in maps or []:
        command += ["-map", label]
    command += [*VIDEO, "-crf", "20", *(AUDIO if audio else ["-an"]), *FAST_START, *(extra or []), out]
    run(command, dry)


# ── the edits ────────────────────────────────────────────────────────────────

def cmd_info(args):
    print(json.dumps(probe(args.input)))


def cmd_trim(args):
    info = probe(args.input)
    start = seconds(args.start) or 0.0
    end = seconds(args.end) if args.end is not None else (start + seconds(args.duration) if args.duration is not None else info["duration"])
    if start >= info["duration"]:
        raise Problem(f"The clip is {info['duration']}s long; it cannot start at {start}s.")
    if end <= start:
        raise Problem("The end must be after the start.")
    end = min(end, info["duration"])
    out = target(args.input, args.output, args.force)
    need("ffmpeg")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", args.input, "-t", f"{end - start:.3f}"]
    # Copying is instant but can only cut on a keyframe; re-encoding cuts on the exact frame.
    command += ["-c", "copy"] if args.copy else [*VIDEO, "-crf", "20", *(AUDIO if info["has_audio"] else ["-an"])]
    run([*command, *FAST_START, out], args.dry_run)
    finish(out, args.dry_run)


def cmd_concat(args):
    clips = [probe(p) for p in args.inputs]
    if len(clips) < 2:
        raise Problem("Give at least two clips to join.")
    if any(not c["has_video"] for c in clips):
        raise Problem("Every clip to join must have a picture.")
    width = even(args.width or clips[0]["width"])
    height = even(args.height or clips[0]["height"])
    fps = args.fps or clips[0]["fps"] or 30
    out = target(None, args.output, args.force)
    for clip in clips:
        if os.path.abspath(clip["path"]) == os.path.abspath(out):
            raise Problem("The output is one of the input files. Give the result a name of its own.")
    inputs, parts, labels = [], [], []
    slot = 0
    for i, clip in enumerate(clips):
        inputs += ["-i", clip["path"]]
        picture = slot
        slot += 1
        # Every clip is fitted to the same frame, so one in another shape is letterboxed, not stretched.
        parts.append(f"[{picture}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{i}]")
        if clip["has_audio"]:
            parts.append(f"[{picture}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
        else:
            # A clip without sound gets silence of its own length, so the others keep their place.
            inputs += ["-f", "lavfi", "-t", f"{clip['duration']:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            parts.append(f"[{slot}:a]anull[a{i}]")
            slot += 1
        labels.append(f"[v{i}][a{i}]")
    parts.append(f"{''.join(labels)}concat=n={len(clips)}:v=1:a=1[v][a]")
    encode(inputs, ";".join(parts), out, args.dry_run, maps=["[v]", "[a]"])
    finish(out, args.dry_run, joined=len(clips))


def cmd_reframe(args):
    info = probe(args.input)
    if not info["has_video"]:
        raise Problem("This file has no picture to reframe.")
    match = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", args.aspect)
    if not match or float(match.group(2)) == 0:
        raise Problem('The aspect is written like 9:16, 1:1, 4:5 or 16:9.')
    ratio = float(match.group(1)) / float(match.group(2))
    height = even(args.height or (1920 if ratio < 1 else 1080))
    width = even(height * ratio)
    if not 0 <= args.focus <= 1:
        raise Problem("--focus is between 0 (left or top) and 1 (right or bottom).")
    if args.mode == "crop":
        # Fill the frame and cut what does not fit; --focus says which part to keep.
        chain = f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}:(iw-ow)*{args.focus}:(ih-oh)*{args.focus},setsar=1[v]"
    elif args.mode == "pad":
        chain = f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v]"
    else:
        # The whole picture, in front of a blurred copy of itself that fills the frame.
        chain = (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur=20:4[blurred];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            f"[blurred][front]overlay=(W-w)/2:(H-h)/2,setsar=1[v]"
        )
    out = target(args.input, args.output, args.force)
    encode(["-i", args.input], chain, out, args.dry_run, maps=["[v]", *(["0:a?"])], audio=info["has_audio"])
    finish(out, args.dry_run)


def cmd_speed(args):
    info = probe(args.input)
    factor = args.factor
    if not 0.1 <= factor <= 16:
        raise Problem("--factor is between 0.1 (ten times slower) and 16.")
    filters = [f"[0:v]setpts=PTS/{factor}[v]"]
    maps = ["[v]"]
    if info["has_audio"]:
        # One atempo step changes speed by at most a factor of two without artefacts; larger changes are chained.
        steps, left = [], factor
        while left > 2.0:
            steps.append("atempo=2.0")
            left /= 2.0
        while left < 0.5:
            steps.append("atempo=0.5")
            left /= 0.5
        steps.append(f"atempo={left:.6f}")
        filters.append(f"[0:a]{','.join(steps)}[a]")
        maps.append("[a]")
    out = target(args.input, args.output, args.force)
    encode(["-i", args.input], ";".join(filters), out, args.dry_run, maps=maps, audio=info["has_audio"])
    finish(out, args.dry_run)


def silences(path, threshold, minimum):
    """The quiet stretches of a file, as (start, end) pairs, found by ffmpeg's own detector."""
    need("ffmpeg")
    log = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", f"silencedetect=noise={threshold}dB:d={minimum}", "-vn", "-f", "null", "-"], capture=True)
    starts = [float(m) for m in re.findall(r"silence_start: (-?[\d.]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end: (-?[\d.]+)", log)]
    return [(max(0.0, s), ends[i] if i < len(ends) else None) for i, s in enumerate(starts)]


def keep_ranges(duration, quiet, pad):
    """What is left when the quiet stretches go, leaving `pad` seconds of each so speech is not clipped."""
    keep, at = [], 0.0
    for start, end in quiet:
        end = duration if end is None else end
        cut_from, cut_to = start + pad, end - pad
        if cut_to - cut_from <= 0.05:
            continue  # shorter than the padding: nothing worth removing
        if cut_from - at > 0.02:
            keep.append((round(at, 3), round(cut_from, 3)))
        at = cut_to
    if duration - at > 0.02:
        keep.append((round(at, 3), round(duration, 3)))
    return keep


def cmd_silence(args):
    info = probe(args.input)
    if not info["has_audio"]:
        raise Problem("This file has no sound, so there is no silence to find.")
    quiet = silences(args.input, args.threshold, args.min)
    keep = keep_ranges(info["duration"], quiet, args.pad)
    removed = round(info["duration"] - sum(b - a for a, b in keep), 3)
    if args.report or not quiet:
        print(json.dumps({"ok": True, "silences": [[round(a, 3), None if b is None else round(b, 3)] for a, b in quiet], "would_remove": removed, "keep": keep}))
        return
    if not keep:
        raise Problem("Nothing would be left: the whole clip is below the threshold. Try a lower --threshold (for example -45).")
    out = target(args.input, args.output, args.force)
    wanted = "+".join(f"between(t,{a},{b})" for a, b in keep)
    filters = f"[0:a]aselect='{wanted}',asetpts=N/SR/TB[a]"
    maps = ["[a]"]
    if info["has_video"]:
        filters = f"[0:v]select='{wanted}',setpts=N/FRAME_RATE/TB[v];" + filters
        maps = ["[v]", "[a]"]
    need("ffmpeg")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", args.input, "-filter_complex", filters]
    for label in maps:
        command += ["-map", label]
    command += [*(VIDEO + ["-crf", "20"] if info["has_video"] else ["-vn"]), *AUDIO, *FAST_START, out]
    run(command, args.dry_run)
    finish(out, args.dry_run, removed_seconds=removed, cuts=len(quiet))


def parse_srt(path):
    """The cues of an .srt file: (start, end, text)."""
    if not os.path.isfile(path):
        raise Problem(f"There is no subtitle file at {path}.")
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        blocks = re.split(r"\r?\n\s*\r?\n", handle.read().strip())
    stamp = r"(\d+):(\d\d):(\d\d)[,.](\d{1,3})"
    cues = []
    for block in blocks:
        lines = [line for line in block.splitlines() if line.strip()]
        timing = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing is None:
            continue
        found = re.findall(stamp, lines[timing])
        if len(found) != 2:
            continue
        start, end = (int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000 for h, m, s, ms in found)
        text = "\n".join(re.sub(r"<[^>]+>", "", line) for line in lines[timing + 1:]).strip()
        if text and end > start:
            cues.append((start, end, text))
    if not cues:
        raise Problem(f"{path} has no captions in .srt form (a number, a line with -->, then the text).")
    return sorted(cues)


FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "C:\\Windows\\Fonts\\arialbd.ttf", "C:\\Windows\\Fonts\\arial.ttf",
]


def load_font(path, size):
    try:
        from PIL import ImageFont
    except ImportError:
        raise Problem("Putting words into the picture needs Pillow: pip install pillow")
    for candidate in ([path] if path else FONTS):
        if candidate and os.path.isfile(candidate):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    if path:
        raise Problem(f"The font at {path} could not be loaded.")
    try:
        return ImageFont.load_default(size)  # Pillow 10.1 and newer
    except TypeError:
        raise Problem("No usable font was found. Pass one with --font /path/to/font.ttf")


def draw_card(text, width, height, font, position, out):
    """One transparent frame the size of the video with `text` on it: white, outlined, wrapped to fit."""
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    if text:
        draw = ImageDraw.Draw(image)
        limit = width * 0.86
        lines = []
        for paragraph in text.split("\n"):
            line = ""
            for word in paragraph.split():
                trial = f"{line} {word}".strip()
                if draw.textlength(trial, font=font) <= limit or not line:
                    line = trial
                else:
                    lines.append(line)
                    line = word
            lines.append(line)
        size = getattr(font, "size", 24)
        gap = int(size * 1.25)
        stroke = max(2, size // 12)
        block = gap * len(lines)
        # Kept clear of the very edge, where a phone's own buttons sit.
        top = {"top": int(height * 0.09), "middle": (height - block) // 2, "bottom": int(height * 0.86) - block}[position]
        for i, line in enumerate(lines):
            x = (width - draw.textlength(line, font=font)) / 2
            draw.text((x, top + i * gap), line, font=font, fill=(255, 255, 255, 255), stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    image.save(out)


def overlay_cues(args, info, cues):
    """Burns timed text into the picture: each cue is drawn once and shown for its stretch of time."""
    if not info["has_video"]:
        raise Problem("This file has no picture to put words on.")
    out = target(args.input, args.output, args.force)
    width, height = info["width"], info["height"]
    font = load_font(args.font, max(12, int(min(width, height) * args.size / 100)))
    work = tempfile.mkdtemp(prefix="vedit-")
    try:
        blank = os.path.join(work, "blank.png")
        draw_card("", width, height, font, args.position, blank)
        # A list of pictures and how long each stays: blank between the cues, and to the end.
        entries, at = [], 0.0
        for i, (start, end, text) in enumerate(cues):
            start, end = max(start, at), min(end, info["duration"])
            if end - start < 0.02:
                continue
            if start - at > 0.001:
                entries.append((blank, start - at))
            card = os.path.join(work, f"cue{i}.png")
            draw_card(text, width, height, font, args.position, card)
            entries.append((card, end - start))
            at = end
        if info["duration"] - at > 0.001:
            entries.append((blank, info["duration"] - at))
        if not any(path != blank for path, _ in entries):
            raise Problem("None of the text falls inside the clip.")
        listing = os.path.join(work, "cues.txt")
        with open(listing, "w", encoding="utf-8") as handle:
            for path, length in entries:
                handle.write(f"file '{path}'\nduration {length:.3f}\n")
            handle.write(f"file '{entries[-1][0]}'\n")  # the list format needs the last picture named twice
        fps = info["fps"] or 30
        filters = f"[1:v]fps={fps},format=rgba[words];[0:v][words]overlay=0:0:eof_action=pass[v]"
        encode(["-i", args.input, "-f", "concat", "-safe", "0", "-i", listing], filters, out, args.dry_run, maps=["[v]", "0:a?"], audio=info["has_audio"])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    finish(out, args.dry_run, cues=len(cues))


def cmd_captions(args):
    overlay_cues(args, probe(args.input), parse_srt(args.srt))


def cmd_text(args):
    info = probe(args.input)
    start = seconds(args.start) or 0.0
    end = seconds(args.end) if args.end is not None else info["duration"]
    if end <= start:
        raise Problem("The end must be after the start.")
    overlay_cues(args, info, [(start, end, args.text.replace("\\n", "\n"))])


def cmd_audio(args):
    info = probe(args.input)
    out = target(args.input, args.output, args.force)
    need("ffmpeg")
    base = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if args.action == "extract":
        if not info["has_audio"]:
            raise Problem("This file has no sound to extract.")
        codec = {".mp3": ["-c:a", "libmp3lame", "-q:a", "2"], ".wav": ["-c:a", "pcm_s16le"], ".m4a": ["-c:a", "aac", "-b:a", "192k"], ".aac": ["-c:a", "aac", "-b:a", "192k"]}.get(os.path.splitext(out)[1].lower())
        if not codec:
            raise Problem("Name the output .m4a, .mp3 or .wav.")
        run([*base, "-i", args.input, "-vn", *codec, out], args.dry_run)
    elif args.action == "normalize":
        if not info["has_audio"]:
            raise Problem("This file has no sound to level.")
        # Loudness is set to one target so clips cut together do not jump in volume.
        run([*base, "-i", args.input, "-af", f"loudnorm=I={args.lufs}:TP=-1.5:LRA=11", *(["-c:v", "copy"] if info["has_video"] else ["-vn"]), *AUDIO, *FAST_START, out], args.dry_run)
    elif args.action == "replace":
        if not args.with_audio:
            raise Problem("Say which sound to use: --with song.mp3")
        probe(args.with_audio)
        run([*base, "-i", args.input, "-i", args.with_audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", *AUDIO, "-shortest", *FAST_START, out], args.dry_run)
    else:  # mix
        if not args.music:
            raise Problem("Say which music to add: --music song.mp3")
        probe(args.music)
        if not 0 < args.music_volume <= 2:
            raise Problem("--music-volume is between 0 and 2 (0.15 is a quiet bed under speech).")
        music = f"[1:a]aresample=48000,aformat=channel_layouts=stereo,volume={args.music_volume}[music]"
        if not info["has_audio"]:
            filters, mixed = music, "[music]"
        elif args.duck:
            # The music drops whenever there is speech, and comes back up in the gaps.
            filters = f"[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[voice][key];{music};[music][key]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[under];[voice][under]amix=inputs=2:duration=first:normalize=0[a]"
            mixed = "[a]"
        else:
            filters = f"[0:a]aresample=48000,aformat=channel_layouts=stereo[voice];{music};[voice][music]amix=inputs=2:duration=first:normalize=0[a]"
            mixed = "[a]"
        # The music repeats if it is shorter than the clip, and stops where the clip stops.
        run([*base, "-i", args.input, "-stream_loop", "-1", "-i", args.music, "-filter_complex", filters, "-map", "0:v:0?", "-map", mixed, "-c:v", "copy", *AUDIO, "-t", f"{info['duration']:.3f}", *FAST_START, out], args.dry_run)
    finish(out, args.dry_run)


def cmd_gif(args):
    info = probe(args.input)
    if not info["has_video"]:
        raise Problem("This file has no picture to make a GIF from.")
    if not args.output.lower().endswith(".gif"):
        raise Problem("Name the output with .gif at the end.")
    out = target(args.input, args.output, args.force)
    start = seconds(args.start) or 0.0
    length = min(seconds(args.duration) if args.duration is not None else 5.0, max(0.1, info["duration"] - start))
    # A palette made from the clip itself: far fewer bands and speckles than the default 256 colours.
    filters = f"[0:v]fps={args.fps},scale={even(args.width)}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
    need("ffmpeg")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", args.input, "-filter_complex", filters, "-loop", "0", out], args.dry_run)
    if not args.dry_run:
        print(json.dumps({"ok": True, "output": os.path.abspath(out), "duration": round(length, 3), "size_mb": round(os.path.getsize(out) / 1_000_000, 2)}))


def cmd_frames(args):
    info = probe(args.input)
    if not info["has_video"]:
        raise Problem("This file has no picture to take frames from.")
    times = [seconds(t) for t in str(args.at).split(",") if t.strip()]
    if not times:
        raise Problem("Say which moments: --at 1.5,4,9")
    single = args.output.lower().endswith((".png", ".jpg", ".jpeg")) and len(times) == 1
    if not single:
        os.makedirs(args.output, exist_ok=True)
    need("ffmpeg")
    written = []
    for moment in times:
        if moment > info["duration"]:
            raise Problem(f"The clip is {info['duration']}s long; there is no frame at {moment}s.")
        path = args.output if single else os.path.join(args.output, f"frame_{moment:07.2f}s.png".replace(" ", "0"))
        if single:
            target(args.input, path, args.force)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{moment:.3f}", "-i", args.input, "-frames:v", "1", path], args.dry_run)
        written.append(os.path.abspath(path))
    if not args.dry_run:
        print(json.dumps({"ok": True, "frames": written}))


def cmd_compress(args):
    info = probe(args.input)
    if not info["has_video"]:
        raise Problem("This file has no picture to compress.")
    out = target(args.input, args.output, args.force)
    need("ffmpeg")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", args.input, *VIDEO]
    if args.max_mb:
        if info["duration"] <= 0:
            raise Problem("The clip's length is unknown, so a size cannot be aimed at.")
        # What the picture may use: the whole budget less the sound, with a little kept back for the file itself.
        sound = 128 if info["has_audio"] else 0
        picture = int(args.max_mb * 8000 * 0.97 / info["duration"] - sound)
        if picture < 150:
            raise Problem(f"{args.max_mb} MB is too small for {info['duration']}s of video. Trim it, or allow a larger file.")
        command += ["-b:v", f"{picture}k", "-maxrate", f"{int(picture * 1.3)}k", "-bufsize", f"{picture * 2}k"]
        audio = ["-c:a", "aac", "-b:a", "128k"] if info["has_audio"] else ["-an"]
    else:
        if not 14 <= args.crf <= 40:
            raise Problem("--crf is between 14 (large, near lossless) and 40 (small, rough). 23 is the usual choice.")
        command += ["-crf", str(args.crf)]
        audio = AUDIO if info["has_audio"] else ["-an"]
    if args.height and info.get("height", 0) > args.height:
        command += ["-vf", f"scale=-2:{even(args.height)}"]
    run([*command, *audio, *FAST_START, out], args.dry_run)
    before = info["size_mb"]
    extra = {} if args.dry_run else {"was_mb": before}
    finish(out, args.dry_run, **extra)


def build():
    parser = argparse.ArgumentParser(prog="vedit.py", description="Everyday video edits on top of ffmpeg. Each edit writes a new file.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--force", action="store_true", help="replace the output file if it exists")
    common.add_argument("--dry-run", action="store_true", help="print the ffmpeg command and run nothing")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("info", help="what a file is: length, size, frame rate, sound")
    p.add_argument("input")
    p.set_defaults(run=cmd_info)

    p = sub.add_parser("trim", parents=[common], help="keep one stretch of a clip")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--start", default="0"); p.add_argument("--end"); p.add_argument("--duration")
    p.add_argument("--copy", action="store_true", help="instant, but cuts only on a keyframe")
    p.set_defaults(run=cmd_trim)

    p = sub.add_parser("concat", parents=[common], help="join clips end to end")
    p.add_argument("output"); p.add_argument("inputs", nargs="+")
    p.add_argument("--width", type=int); p.add_argument("--height", type=int); p.add_argument("--fps", type=float)
    p.set_defaults(run=cmd_concat)

    p = sub.add_parser("reframe", parents=[common], help="another shape: 9:16, 1:1, 4:5, 16:9")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--aspect", required=True); p.add_argument("--mode", choices=["crop", "pad", "blur"], default="crop")
    p.add_argument("--height", type=int); p.add_argument("--focus", type=float, default=0.5)
    p.set_defaults(run=cmd_reframe)

    p = sub.add_parser("speed", parents=[common], help="faster or slower, with the sound kept in tune")
    p.add_argument("input"); p.add_argument("output"); p.add_argument("--factor", type=float, required=True)
    p.set_defaults(run=cmd_speed)

    p = sub.add_parser("silence", parents=[common], help="cut out the quiet stretches")
    p.add_argument("input"); p.add_argument("output", nargs="?", default="")
    p.add_argument("--threshold", type=float, default=-35.0, help="how quiet counts as silence, in dB")
    p.add_argument("--min", type=float, default=0.5, help="shortest silence to cut, in seconds")
    p.add_argument("--pad", type=float, default=0.12, help="seconds of each silence to leave in")
    p.add_argument("--report", action="store_true", help="only say what would be cut")
    p.set_defaults(run=cmd_silence)

    for name, about in (("captions", "burn an .srt file into the picture"), ("text", "put a line of text on the picture")):
        p = sub.add_parser(name, parents=[common], help=about)
        p.add_argument("input"); p.add_argument("output")
        if name == "captions":
            p.add_argument("--srt", required=True)
        else:
            p.add_argument("--text", required=True); p.add_argument("--start", default="0"); p.add_argument("--end")
        p.add_argument("--size", type=float, default=5.0, help="text height as a percentage of the shorter side")
        p.add_argument("--position", choices=["top", "middle", "bottom"], default="bottom" if name == "captions" else "middle")
        p.add_argument("--font")
        p.set_defaults(run=cmd_captions if name == "captions" else cmd_text)

    p = sub.add_parser("audio", parents=[common], help="extract, level, replace or add music")
    p.add_argument("action", choices=["extract", "normalize", "replace", "mix"])
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--with", dest="with_audio"); p.add_argument("--music")
    p.add_argument("--music-volume", type=float, default=0.15); p.add_argument("--duck", action="store_true")
    p.add_argument("--lufs", type=float, default=-14.0)
    p.set_defaults(run=cmd_audio)

    p = sub.add_parser("gif", parents=[common], help="a short GIF")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--start", default="0"); p.add_argument("--duration")
    p.add_argument("--width", type=int, default=480); p.add_argument("--fps", type=int, default=12)
    p.set_defaults(run=cmd_gif)

    p = sub.add_parser("frames", parents=[common], help="still pictures at given moments, to look at")
    p.add_argument("input"); p.add_argument("output"); p.add_argument("--at", required=True)
    p.set_defaults(run=cmd_frames)

    p = sub.add_parser("compress", parents=[common], help="a smaller file")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--crf", type=int, default=23); p.add_argument("--max-mb", type=float); p.add_argument("--height", type=int)
    p.set_defaults(run=cmd_compress)
    return parser


def main(argv=None):
    args = build().parse_args(argv)
    if args.command == "silence" and not args.report and not args.output:
        print(json.dumps({"ok": False, "error": "Give the output file, or add --report to only see what would be cut."}))
        return 2
    try:
        args.run(args)
    except Problem as problem:
        print(json.dumps({"ok": False, "error": str(problem)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
