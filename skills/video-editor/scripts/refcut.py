#!/usr/bin/env python3
"""refcut: measure a reference video's edit, rebuild it with your own footage, and check the match.

It needs ffmpeg and ffprobe on the PATH and Python 3.8 or newer. Nothing else: no numpy, no OpenCV.
Every command prints one JSON object. Nothing given to it is ever written over.

    refcut.py analyze ref.mp4 --out ref.json --stills ref-shots/
    refcut.py plan ref.json plan.json --footage a.mp4 b.mp4 c.mov [--music song.mp3 --snap beats]
    refcut.py lut ref.json look.cube --from a.mp4 b.mp4 [--strength 0.8]
    refcut.py render plan.json out.mp4
    refcut.py compare ref.json out.mp4

What `analyze` measures: every hard cut and so every shot length (pace, the hook, the rhythm curve),
how much each shot moves, the look (Lab colour means and spreads, saturation, palette, letterbox),
loudness (integrated LUFS, range, true peak), the music's tempo, beats and onsets, how many cuts land
on a beat, and fades to black. What it can NOT measure, and the editor must look at the stills for:
on-screen text and caption style, zooms and camera moves, speed ramps, transitions other than hard
cuts and fades, sound effects. Dissolves are often not detected as cuts.
"""
import argparse
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile

SAMPLE = 24                   # analysis frames are scaled to SAMPLE x SAMPLE pixels
ENV_RATE = 100                # audio envelope frames per second
AUDIO_RATE = 8000


class Problem(Exception):
    """Something the person asking can act on: said in one line, with no traceback."""


# ── running ffmpeg ───────────────────────────────────────────────────────────

def need(program):
    if not shutil.which(program):
        raise Problem(f"{program} is not installed. On a Mac: brew install ffmpeg. On Debian or Ubuntu: sudo apt install ffmpeg.")


def ff(args, binary=False, cwd=None):
    """Run ffmpeg; return (stdout, stderr). stdout is bytes when binary."""
    need("ffmpeg")
    done = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
    err = done.stderr.decode("utf-8", "replace")
    if done.returncode != 0:
        tail = "\n".join(err.strip().splitlines()[-6:])
        raise Problem(f"ffmpeg could not do this:\n{tail}")
    return (done.stdout if binary else done.stdout.decode("utf-8", "replace")), err


def probe(path):
    need("ffprobe")
    if not os.path.isfile(path):
        raise Problem(f"There is no file at {path}.")
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    if out.returncode != 0:
        raise Problem(f"{path} is not a video or audio file ffprobe can read.")
    data = json.loads(out.stdout or "{}")
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    info = {"path": os.path.abspath(path), "duration": round(float(data.get("format", {}).get("duration") or 0), 3),
            "has_video": bool(video), "has_audio": bool(audio)}
    if video:
        w, h = int(video["width"]), int(video["height"])
        turn = abs(int(float(next((d.get("rotation", 0) for d in video.get("side_data_list", []) if "rotation" in d), 0))))
        if turn in (90, 270):
            w, h = h, w
        num, _, den = (video.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den) if float(den or 0) else 0.0
        info.update({"width": w, "height": h, "fps": round(fps, 3), "aspect": aspect_name(w, h)})
    return info


def aspect_name(w, h):
    if not w or not h:
        return None
    r = w / h
    for name, value in (("9:16", 9 / 16), ("4:5", 4 / 5), ("1:1", 1.0), ("16:9", 16 / 9), ("1.85:1", 1.85), ("2.39:1", 2.39), ("4:3", 4 / 3)):
        if abs(r - value) / value < 0.02:
            return name
    return f"{r:.3f}:1"


# ── pure helpers (tested without ffmpeg) ─────────────────────────────────────

def shots_from_cuts(cuts, duration, min_len=0.25):
    """Cut times -> [(start, end)], dropping cuts that would leave a shot shorter than min_len (flashes)."""
    kept, last = [], 0.0
    for t in sorted(cuts):
        if t - last >= min_len and duration - t >= min_len:
            kept.append(t)
            last = t
    edges = [0.0, *kept, duration]
    return [(round(a, 3), round(b, 3)) for a, b in zip(edges, edges[1:])]


def pacing(shots, window=5.0):
    """Shot-length statistics and the cuts-per-window curve that shows where the edit speeds up."""
    lengths = [b - a for a, b in shots]
    total = shots[-1][1] if shots else 0
    curve = []
    t = 0.0
    while t < total:
        curve.append(sum(1 for a, _ in shots[1:] if t <= a < t + window))
        t += window
    return {
        "shots": len(shots),
        "asl": round(statistics.mean(lengths), 3) if lengths else 0,
        "median": round(statistics.median(lengths), 3) if lengths else 0,
        "shortest": round(min(lengths), 3) if lengths else 0,
        "longest": round(max(lengths), 3) if lengths else 0,
        "stdev": round(statistics.pstdev(lengths), 3) if lengths else 0,
        "cuts_per_minute": round((len(shots) - 1) / total * 60, 2) if total else 0,
        "first_cut": shots[1][0] if len(shots) > 1 else None,
        "cuts_per_window": {"window_s": window, "counts": curve},
    }


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _f(t):
    return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116


def rgb_to_lab(r, g, b):
    """sRGB 0..255 -> CIE Lab (D65)."""
    r, g, b = _lin(r), _lin(g), _lin(b)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
    fx, fy, fz = _f(x), _f(y), _f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def lab_to_rgb(L, a, b):
    """CIE Lab (D65) -> sRGB 0..1, clamped."""
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200

    def inv(t):
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    x, y, z = inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883
    rgb = (3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
           -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
           0.0556434 * x - 0.2040259 * y + 1.0572252 * z)
    out = []
    for c in rgb:
        c = max(0.0, c)
        c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        out.append(min(1.0, max(0.0, c)))
    return tuple(out)


def lab_stats(pixels):
    """[(r,g,b)] -> mean and spread of L, a, b plus mean chroma (saturation)."""
    labs = [rgb_to_lab(*p) for p in pixels]
    if not labs:
        return None
    cols = list(zip(*labs))
    chroma = [math.hypot(a, b) for _, a, b in labs]
    return {
        "L_mean": round(statistics.mean(cols[0]), 2), "L_std": round(statistics.pstdev(cols[0]), 2),
        "a_mean": round(statistics.mean(cols[1]), 2), "a_std": round(statistics.pstdev(cols[1]), 2),
        "b_mean": round(statistics.mean(cols[2]), 2), "b_std": round(statistics.pstdev(cols[2]), 2),
        "chroma_mean": round(statistics.mean(chroma), 2),
    }


def describe_look(s):
    """Plain words for a look, so the report reads like an editor's note."""
    if not s:
        return []
    words = []
    words.append("bright" if s["L_mean"] > 62 else "dark / low-key" if s["L_mean"] < 38 else "mid-key")
    words.append("high contrast" if s["L_std"] > 26 else "flat / low contrast" if s["L_std"] < 14 else "normal contrast")
    words.append("warm" if s["b_mean"] > 8 else "cool / blue" if s["b_mean"] < -4 else "neutral white balance")
    if s["a_mean"] > 6:
        words.append("magenta tint")
    elif s["a_mean"] < -5:
        words.append("green tint")
    words.append("saturated" if s["chroma_mean"] > 30 else "desaturated / muted" if s["chroma_mean"] < 12 else "moderate saturation")
    return words


def transfer(lab, src, dst, strength=1.0):
    """Reinhard colour transfer of one Lab value from the source's statistics to the reference's.
    Spread ratios are clamped to 0.5..2 so a flat clip is not blown apart."""
    out = []
    for v, ch in zip(lab, ("L", "a", "b")):
        ratio = dst[f"{ch}_std"] / src[f"{ch}_std"] if src[f"{ch}_std"] > 1e-6 else 1.0
        ratio = min(2.0, max(0.5, ratio))
        moved = (v - src[f"{ch}_mean"]) * ratio + dst[f"{ch}_mean"]
        out.append(v + (moved - v) * strength)
    return tuple(out)


def cube_lut(src, dst, size=33, strength=1.0):
    """Text of a .cube 3D LUT that moves footage with `src` statistics towards `dst` (red fastest)."""
    lines = [f'TITLE "refcut look match"', f"LUT_3D_SIZE {size}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    step = 255 / (size - 1)
    for bi in range(size):
        for gi in range(size):
            for ri in range(size):
                lab = rgb_to_lab(ri * step, gi * step, bi * step)
                r, g, b = lab_to_rgb(*transfer(lab, src, dst, strength))
                lines.append(f"{r:.6f} {g:.6f} {b:.6f}")
    return "\n".join(lines) + "\n"


def palette(pixels, count=6):
    """Most common colours after coarse quantisation, as hex."""
    buckets = {}
    for r, g, b in pixels:
        key = (r >> 5, g >> 5, b >> 5)
        acc = buckets.setdefault(key, [0, 0, 0, 0])
        acc[0] += r; acc[1] += g; acc[2] += b; acc[3] += 1
    top = sorted(buckets.values(), key=lambda v: -v[3])[:count]
    total = len(pixels) or 1
    return [{"hex": "#%02x%02x%02x" % (v[0] // v[3], v[1] // v[3], v[2] // v[3]), "share": round(v[3] / total, 3)} for v in top]


def onset_strength(envelope):
    """Positive change of log energy per envelope frame."""
    logs = [math.log(1e-6 + e) for e in envelope]
    return [0.0] + [max(0.0, logs[i] - logs[i - 1]) for i in range(1, len(logs))]


def pick_onsets(strength, rate=ENV_RATE, min_gap=0.1):
    if not strength:
        return []
    sd = statistics.pstdev(strength) or 1e-9
    half = 15
    prefix = [0.0]
    for v in strength:
        prefix.append(prefix[-1] + v)
    out, last = [], -1e9
    for i, v in enumerate(strength):
        lo, hi = max(0, i - half), min(len(strength), i + half + 1)
        local = (prefix[hi] - prefix[lo]) / (hi - lo)
        if v <= local + 0.5 * sd or v <= 0:
            continue
        if v < max(strength[max(0, i - 3):i + 4]):
            continue
        t = i / rate
        if t - last >= min_gap:
            out.append(round(t, 3))
            last = t
    return out


def tempo(strength, rate=ENV_RATE, lo_bpm=60, hi_bpm=180):
    """Tempo by autocorrelation of onset strength, and the beat grid with the best phase."""
    n = len(strength)
    if n < rate * 3:
        return None
    mean = statistics.mean(strength)
    x = [v - mean for v in strength]
    r0 = sum(v * v for v in x) or 1e-9
    best, best_lag = -1.0, None
    for lag in range(int(rate * 60 / hi_bpm), int(rate * 60 / lo_bpm) + 1):
        r = sum(x[i] * x[i + lag] for i in range(n - lag)) / r0
        if r > best:
            best, best_lag = r, lag
    if not best_lag:
        return None
    phase = max(range(best_lag), key=lambda p: sum(strength[p::best_lag]))
    beats = [round(i / rate, 3) for i in range(phase, n, best_lag)]
    return {"bpm": round(60 * rate / best_lag, 1), "confidence": round(max(0.0, best), 3), "beats": beats}


def nearest(t, grid):
    return min(grid, key=lambda g: abs(g - t)) if grid else None


def cut_alignment(cuts, grid, tolerance=0.08):
    """Share of cuts within `tolerance` seconds of a grid point (beats or onsets)."""
    if not cuts or not grid:
        return None
    hits = sum(1 for c in cuts if abs(nearest(c, grid) - c) <= tolerance)
    return round(hits / len(cuts), 3)


def snap(times, grid, tolerance=0.15, min_len=0.2):
    """Move each time to the nearest grid point within tolerance, keeping order and a minimum gap."""
    out, last = [], 0.0
    for t in times:
        g = nearest(t, grid)
        v = g if g is not None and abs(g - t) <= tolerance else t
        if v - last < min_len:
            v = t if t - last >= min_len else last + min_len
        out.append(round(v, 3))
        last = v
    return out


def timing_error(ref_cuts, out_cuts):
    """Mean and worst distance from each reference cut to the nearest cut in the result."""
    if not ref_cuts:
        return {"mean": 0.0, "worst": 0.0}
    if not out_cuts:
        return {"mean": None, "worst": None}
    d = [abs(nearest(c, out_cuts) - c) for c in ref_cuts]
    return {"mean": round(statistics.mean(d), 3), "worst": round(max(d), 3)}


def delta_e(s1, s2):
    """CIE76 distance between two looks' mean colours (under ~3 is hard to tell apart)."""
    return round(math.sqrt(sum((s1[k] - s2[k]) ** 2 for k in ("L_mean", "a_mean", "b_mean"))), 2)


# ── measuring a file ─────────────────────────────────────────────────────────

def detect_cuts(path, threshold):
    _, err = ff(["-i", path, "-an", "-vf", f"scale=160:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-"])
    return [float(m) for m in re.findall(r"pts_time:([0-9.]+)", err)]


def sample_frames(path, duration):
    """Tiny RGB frames across the whole file: [(time, [(r,g,b)...])]."""
    fps = max(0.5, min(4.0, 1200 / max(duration, 1)))
    raw, _ = ff(["-i", path, "-an", "-vf", f"fps={fps:.4f},scale={SAMPLE}:{SAMPLE}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], binary=True)
    size = SAMPLE * SAMPLE * 3
    frames = []
    for i in range(len(raw) // size):
        chunk = raw[i * size:(i + 1) * size]
        frames.append(((i + 0.5) / fps, [tuple(chunk[j:j + 3]) for j in range(0, size, 3)]))
    return frames


def frame_motion(a, b):
    return sum(abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2]) for p, q in zip(a, b)) / (len(a) * 3)


def letterbox(path):
    _, err = ff(["-i", path, "-an", "-vf", "fps=1,cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"])
    found = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", err)
    if not found:
        return None
    w, h, x, y = map(int, found[-1])
    return {"width": w, "height": h, "x": x, "y": y, "aspect": aspect_name(w, h)}


def loudness(path):
    _, err = ff(["-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = err[err.rfind("Summary:"):] if "Summary:" in err else err

    def grab(pattern):
        m = re.search(pattern, tail)
        return float(m.group(1)) if m and m.group(1) not in ("-inf", "inf") else None
    return {"integrated_lufs": grab(r"I:\s+(-?[\d.]+|-inf) LUFS"), "range_lu": grab(r"LRA:\s+(-?[\d.]+) LU"),
            "true_peak_dbfs": grab(r"Peak:\s+(-?[\d.]+|-inf) dBFS")}


def envelope(path):
    raw, _ = ff(["-i", path, "-vn", "-ac", "1", "-ar", str(AUDIO_RATE), "-f", "s16le", "-"], binary=True)
    hop = AUDIO_RATE // ENV_RATE
    samples = memoryview(raw).cast("h") if len(raw) % 2 == 0 else memoryview(raw[:-1]).cast("h")
    env = []
    for i in range(0, len(samples) - hop + 1, hop):
        block = samples[i:i + hop]
        env.append(math.sqrt(sum(s * s for s in block) / hop) / 32768)
    return env


def rhythm(path):
    s = onset_strength(envelope(path))
    t = tempo(s)
    return {"onsets": pick_onsets(s), "tempo": t}


def blacks(path):
    _, err = ff(["-i", path, "-an", "-vf", "blackdetect=d=0.08:pix_th=0.10", "-f", "null", "-"])
    return [{"start": float(a), "end": float(b)} for a, b in re.findall(r"black_start:([0-9.]+) black_end:([0-9.]+)", err)]


def analyze(path, threshold=0.3, min_shot=0.25, stills=None, quick=False):
    info = probe(path)
    if not info["has_video"]:
        raise Problem(f"{path} has no picture to analyse.")
    dur = info["duration"]
    cuts = detect_cuts(path, threshold)
    shots = shots_from_cuts(cuts, dur, min_shot)
    frames = sample_frames(path, dur)
    report = {"source": info, "settings": {"scene_threshold": threshold, "min_shot": min_shot}}
    shot_rows = []
    for i, (a, b) in enumerate(shots):
        inside = [f for f in frames if a <= f[0] < b]
        moves = [frame_motion(x[1], y[1]) for x, y in zip(inside, inside[1:])]
        lum = [statistics.mean(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in f[1]) for f in inside]
        shot_rows.append({"i": i, "start": a, "end": b, "duration": round(b - a, 3),
                          "motion": round(statistics.mean(moves), 2) if moves else 0.0,
                          "brightness": round(statistics.mean(lum), 1) if lum else None})
    report["shots"] = shot_rows
    report["pacing"] = pacing(shots)
    pixels = [p for _, f in frames[::max(1, len(frames) // 300)] for p in f]
    look = lab_stats(pixels)
    report["look"] = {"lab": look, "words": describe_look(look), "palette": palette(pixels)}
    if not quick:
        report["look"]["letterbox"] = letterbox(path)
        report["fades_to_black"] = blacks(path)
    if info["has_audio"]:
        report["audio"] = loudness(path)
        r = rhythm(path)
        cut_times = [a for a, _ in shots[1:]]
        t = r["tempo"]
        report["audio"].update({
            "tempo_bpm": t["bpm"] if t else None, "tempo_confidence": t["confidence"] if t else None,
            "beats": t["beats"][:600] if t else [], "onsets": r["onsets"][:600],
            "cuts_on_beat": cut_alignment(cut_times, t["beats"]) if t else None,
            "cuts_on_onset": cut_alignment(cut_times, r["onsets"]),
        })
    else:
        report["audio"] = None
    if stills:
        os.makedirs(stills, exist_ok=True)
        picks = shot_rows if len(shot_rows) <= 80 else [shot_rows[round(i * (len(shot_rows) - 1) / 79)] for i in range(80)]
        for row in picks:
            mid = row["start"] + row["duration"] / 2
            name = os.path.join(stills, f"shot{row['i']:03d}_{mid:07.2f}s.jpg")
            ff(["-y", "-loglevel", "error", "-ss", f"{mid:.3f}", "-i", path, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", name])
            row["still"] = os.path.abspath(name)
    report["not_measured"] = ["on-screen text and caption style", "zooms, punch-ins and camera moves", "speed ramps",
                              "dissolves, whips and other transitions", "sound effects", "what is in each shot"]
    return report


# ── commands ─────────────────────────────────────────────────────────────────

def out_path(path, force, sources=()):
    for s in sources:
        if s and os.path.abspath(s) == os.path.abspath(path):
            raise Problem("The output is one of the inputs. Give the result a name of its own.")
    if os.path.exists(path) and not force:
        raise Problem(f"{path} already exists. Choose another name, or add --force to replace it.")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    return path


def load_analysis(path):
    if not os.path.isfile(path):
        raise Problem(f"There is no file at {path}.")
    if path.endswith(".json"):
        with open(path) as fh:
            return json.load(fh)
    return analyze(path, quick=True)


def cmd_analyze(a):
    report = analyze(a.input, a.threshold, a.min_shot, a.stills)
    if a.out:
        with open(out_path(a.out, a.force, [a.input]), "w") as fh:
            json.dump(report, fh, indent=1)
        p, look, audio = report["pacing"], report["look"], report["audio"] or {}
        print(json.dumps({"ok": True, "output": os.path.abspath(a.out), "duration": report["source"]["duration"],
                          "size": f"{report['source'].get('width')}x{report['source'].get('height')}", "fps": report["source"].get("fps"),
                          "shots": p["shots"], "asl": p["asl"], "cuts_per_minute": p["cuts_per_minute"], "first_cut": p["first_cut"],
                          "look": look["words"], "lufs": audio.get("integrated_lufs"), "tempo_bpm": audio.get("tempo_bpm"),
                          "cuts_on_beat": audio.get("cuts_on_beat")}))
    else:
        print(json.dumps(report))


def cmd_plan(a):
    ref = load_analysis(a.reference)
    clips = [probe(p) for p in a.footage]
    clips = [c for c in clips if c["has_video"]]
    if not clips:
        raise Problem("None of the footage files has a picture.")
    src = ref["source"]
    width, height = a.width or src["width"], a.height or src["height"]
    if a.aspect:
        num, den = (float(x) for x in a.aspect.split(":"))
        height = a.height or (1920 if num < den else 1080)
        width = int(round(height * num / den / 2) * 2)
    fps = a.fps or (src.get("fps") if src.get("fps") and src["fps"] <= 60 else 30)
    lengths = [s["duration"] for s in ref["shots"]]
    scale = (a.duration / sum(lengths)) if a.duration else 1.0
    bounds = []
    t = 0.0
    for d in lengths[:-1]:
        t += d * scale
        bounds.append(t)
    total = sum(lengths) * scale
    music_rhythm = None
    if a.music:
        info = probe(a.music)
        if not info["has_audio"]:
            raise Problem(f"{a.music} has no sound.")
        music_rhythm = rhythm(a.music)
    grid = None
    if a.snap != "none":
        source = music_rhythm or ({"onsets": (ref.get("audio") or {}).get("onsets", []), "tempo": {"beats": (ref.get("audio") or {}).get("beats", [])}})
        grid = (source.get("tempo") or {}).get("beats", []) if a.snap == "beats" else source.get("onsets", [])
        if a.music_start and grid:
            grid = [g - a.music_start for g in grid if g >= a.music_start]
        if grid:
            bounds = snap(bounds, grid, a.tolerance)
    edges = [0.0, *bounds, total]
    cursors = {c["path"]: 0.0 for c in clips}
    segments = []
    for i, (s, e) in enumerate(zip(edges, edges[1:])):
        clip = clips[i % len(clips)]
        dur = round(e - s, 3)
        start = cursors[clip["path"]]
        if start + dur > clip["duration"]:
            start = 0.0
        # Two segments from one clip back to back would play as one continuous shot: skip ahead so the
        # cut is visible (a jump cut), as the reference has a cut there.
        cursors[clip["path"]] = start + dur + (0.75 if len(clips) == 1 else 0.0)
        ref_shot = ref["shots"][i]
        segments.append({"i": i, "src": clip["path"], "in": round(start, 3), "duration": dur, "speed": 1.0,
                         "ref": {"start": ref_shot["start"], "end": ref_shot["end"], "motion": ref_shot.get("motion"), "still": ref_shot.get("still")},
                         "footage_short": dur > clip["duration"]})
    plan = {
        "reference": src.get("path"), "width": width, "height": height, "fps": fps, "duration": round(total, 3),
        "segments": segments, "lut": a.lut and os.path.abspath(a.lut),
        "audio": {"music": a.music and os.path.abspath(a.music), "music_start": a.music_start, "keep_source_audio": a.keep_audio,
                  "music_volume_under_source": 0.25,
                  "lufs": a.lufs if a.lufs is not None else ((ref.get("audio") or {}).get("integrated_lufs") or -14.0)},
        "snapped_to": (a.snap if grid else None),
        "note": "Edit 'src', 'in' and 'speed' per segment to pick the right moment for each shot; keep 'duration' to keep the reference's rhythm.",
    }
    with open(out_path(a.out, a.force, [a.reference]), "w") as fh:
        json.dump(plan, fh, indent=1)
    print(json.dumps({"ok": True, "output": os.path.abspath(a.out), "segments": len(segments), "size": f"{width}x{height}",
                      "fps": fps, "duration": plan["duration"], "snapped_to": plan["snapped_to"],
                      "footage_short": sum(1 for s in segments if s["footage_short"])}))


def cmd_lut(a):
    ref = load_analysis(a.reference)
    dst = ref["look"]["lab"]
    pixels = []
    for p in a.sources:
        info = probe(p)
        frames = sample_frames(p, info["duration"])
        pixels += [px for _, f in frames[::max(1, len(frames) // 120)] for px in f]
    src = lab_stats(pixels)
    with open(out_path(a.out, a.force, a.sources), "w") as fh:
        fh.write(cube_lut(src, dst, a.size, a.strength))
    print(json.dumps({"ok": True, "output": os.path.abspath(a.out), "from_look": describe_look(src), "to_look": describe_look(dst),
                      "delta_e_before": delta_e(src, dst), "strength": a.strength}))


def atempo(speed):
    parts, s = [], speed
    while s > 2.0:
        parts.append("atempo=2.0"); s /= 2.0
    while s < 0.5:
        parts.append("atempo=0.5"); s /= 0.5
    parts.append(f"atempo={s:.4f}")
    return ",".join(parts)


def cmd_render(a):
    with open(a.plan) as fh:
        plan = json.load(fh)
    out = out_path(a.out, a.force, [a.plan, *(s["src"] for s in plan["segments"])])
    W, H, fps = int(plan["width"]), int(plan["height"]), float(plan["fps"])
    audio_cfg = plan.get("audio") or {}
    keep = bool(audio_cfg.get("keep_source_audio"))
    work = tempfile.mkdtemp(prefix="refcut-")
    try:
        if plan.get("lut"):
            if not os.path.isfile(plan["lut"]):
                raise Problem(f"The LUT {plan['lut']} does not exist.")
            shutil.copy(plan["lut"], os.path.join(work, "look.cube"))
        infos = {}
        names = []
        for seg in plan["segments"]:
            src = seg["src"]
            info = infos.get(src) or infos.setdefault(src, probe(src))
            speed = float(seg.get("speed") or 1.0)
            dur = float(seg["duration"])
            frames = max(1, round(dur * fps))
            need_src = dur * speed
            vf = [f"scale={W}:{H}:force_original_aspect_ratio=increase", f"crop={W}:{H}", "setsar=1"]
            if speed != 1.0:
                vf.append(f"setpts=PTS/{speed}")
            vf.append(f"fps={fps}")
            if plan.get("lut"):
                vf.append("lut3d=file=look.cube")
            vf += [f"tpad=stop_mode=clone:stop_duration={dur + 1:.3f}", "format=yuv420p"]
            name = f"seg{seg['i']:04d}.mp4"
            args = ["-y", "-loglevel", "error", "-ss", f"{float(seg['in']):.3f}", "-t", f"{need_src + 0.5:.3f}", "-i", os.path.abspath(src)]
            # Picture and sound go to separate files. Sound is PCM trimmed to exactly the picture's frame
            # count, so joining many segments never lets audio padding push the cuts later.
            args += ["-map", "0:v", "-an", "-vf", ",".join(vf), "-frames:v", str(frames), "-c:v", "libx264", "-preset", "fast",
                     "-crf", "17", "-r", str(fps), name]
            if keep:
                length = f"{frames / fps:.6f}"
                if info["has_audio"]:
                    af = (atempo(speed) + "," if speed != 1.0 else "") + f"aresample=48000,apad,atrim=0:{length}"
                    args += ["-map", "0:a:0", "-vn", "-af", af]
                else:
                    args += ["-f", "lavfi", "-t", length, "-i", "anullsrc=r=48000:cl=stereo", "-map", "1:a", "-vn"]
                args += ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", name.replace(".mp4", ".wav")]
            ff(args, cwd=work)
            names.append(name)
        with open(os.path.join(work, "list.txt"), "w") as fh:
            fh.write("".join(f"file '{n}'\n" for n in names))
        ff(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "joined.mp4"], cwd=work)
        if keep:
            with open(os.path.join(work, "alist.txt"), "w") as fh:
                fh.write("".join(f"file '{n.replace('.mp4', '.wav')}'\n" for n in names))
            ff(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "alist.txt", "-c", "copy", "joined.wav"], cwd=work)
        total = sum(max(1, round(float(s["duration"]) * fps)) for s in plan["segments"]) / fps
        lufs = float(audio_cfg.get("lufs") or -14.0)
        norm = f"loudnorm=I={lufs}:TP=-1.0:LRA=11"
        music = audio_cfg.get("music")
        final = ["-y", "-loglevel", "error", "-i", os.path.join(work, "joined.mp4")]
        if keep:
            final += ["-i", os.path.join(work, "joined.wav")]
        if music:
            m = 2 if keep else 1
            final += ["-ss", f"{float(audio_cfg.get('music_start') or 0):.3f}", "-i", os.path.abspath(music)]
            fade = f"afade=t=out:st={max(0.0, total - 0.6):.3f}:d=0.6"
            if keep:
                vol = float(audio_cfg.get("music_volume_under_source", 0.25))
                fc = f"[{m}:a]volume={vol},atrim=0:{total:.3f},{fade}[m];[1:a][m]amix=inputs=2:duration=first:normalize=0,{norm}[a]"
            else:
                fc = f"[{m}:a]atrim=0:{total:.3f},{fade},{norm}[a]"
            final += ["-filter_complex", fc, "-map", "0:v", "-map", "[a]"]
        elif keep:
            final += ["-map", "0:v", "-map", "1:a", "-af", norm]
        else:
            final += ["-map", "0:v"]
        final += ["-c:v", "copy"]
        if music or keep:
            final += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
        final += ["-t", f"{total:.3f}", "-movflags", "+faststart", os.path.abspath(out)]
        ff(final)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    info = probe(out)
    print(json.dumps({"ok": True, "output": info["path"], "duration": info["duration"], "size": f"{info.get('width')}x{info.get('height')}",
                      "fps": info.get("fps"), "has_audio": info["has_audio"], "segments": len(plan["segments"])}))


def cmd_compare(a):
    ref = load_analysis(a.reference)
    res = analyze(a.result, ref["settings"]["scene_threshold"], ref["settings"]["min_shot"], quick=True)
    rc = [s["start"] for s in ref["shots"][1:]]
    oc = [s["start"] for s in res["shots"][1:]]
    fps = res["source"].get("fps") or 30
    err = timing_error(rc, oc)
    ra, oa = ref.get("audio") or {}, res.get("audio") or {}
    rep = {
        "duration": {"reference": ref["source"]["duration"], "result": res["source"]["duration"]},
        "size": {"reference": f"{ref['source'].get('width')}x{ref['source'].get('height')}", "result": f"{res['source'].get('width')}x{res['source'].get('height')}"},
        "shots": {"reference": ref["pacing"]["shots"], "result": res["pacing"]["shots"]},
        "asl": {"reference": ref["pacing"]["asl"], "result": res["pacing"]["asl"]},
        "cut_timing_s": err,
        "cuts_within_2_frames": round(sum(1 for c in rc if oc and abs(nearest(c, oc) - c) <= 2 / fps) / len(rc), 3) if rc else None,
        "look_delta_e": delta_e(ref["look"]["lab"], res["look"]["lab"]),
        "look": {"reference": ref["look"]["words"], "result": res["look"]["words"]},
        "lufs": {"reference": ra.get("integrated_lufs"), "result": oa.get("integrated_lufs")},
        "tempo_bpm": {"reference": ra.get("tempo_bpm"), "result": oa.get("tempo_bpm")},
    }
    gaps = []
    if rep["shots"]["reference"] != rep["shots"]["result"]:
        gaps.append("shot count differs: a cut was missed or added (or a cut inside your footage was detected)")
    if err["mean"] is not None and err["mean"] > 2 / fps:
        gaps.append("cuts land off the reference timing")
    if rep["look_delta_e"] > 6:
        gaps.append("colour look is visibly different: build or strengthen a LUT")
    if ra.get("integrated_lufs") is not None and oa.get("integrated_lufs") is not None and abs(ra["integrated_lufs"] - oa["integrated_lufs"]) > 1.5:
        gaps.append("loudness differs by more than 1.5 LU")
    rep["gaps"] = gaps
    rep["not_compared"] = ref.get("not_measured", [])
    print(json.dumps(rep))


def build():
    p = argparse.ArgumentParser(prog="refcut.py", description="Measure a reference edit, rebuild it with your footage, and check the match.")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("analyze", help="measure a reference video's edit")
    s.add_argument("input")
    s.add_argument("--out", help="write the full analysis here (prints a summary instead)")
    s.add_argument("--stills", help="folder for one still per shot, to look at")
    s.add_argument("--threshold", type=float, default=0.3, help="scene-change score for a cut, 0..1 (lower finds more)")
    s.add_argument("--min-shot", type=float, default=0.25, help="ignore 'shots' shorter than this (flashes)")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_analyze)

    s = sub.add_parser("plan", help="an edit plan with the reference's shot rhythm, filled with your footage")
    s.add_argument("reference", help="analysis .json (or a video, analysed quickly)")
    s.add_argument("out")
    s.add_argument("--footage", nargs="+", required=True)
    s.add_argument("--music", help="your soundtrack; its beats can drive the cuts")
    s.add_argument("--music-start", type=float, default=0.0)
    s.add_argument("--snap", choices=["none", "beats", "onsets"], default="none", help="move cuts onto the music's beats or hits")
    s.add_argument("--tolerance", type=float, default=0.15, help="how far a cut may move when snapping, seconds")
    s.add_argument("--keep-audio", action="store_true", help="keep the footage's own sound (speech)")
    s.add_argument("--lut", help=".cube look applied to every shot")
    s.add_argument("--lufs", type=float, help="loudness target; default: the reference's, else -14")
    s.add_argument("--aspect", help="e.g. 9:16 to change the shape from the reference's")
    s.add_argument("--width", type=int)
    s.add_argument("--height", type=int)
    s.add_argument("--fps", type=float)
    s.add_argument("--duration", type=float, help="stretch or squeeze the whole rhythm to this length")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_plan)

    s = sub.add_parser("lut", help="a .cube LUT that moves your footage's colour towards the reference's look")
    s.add_argument("reference")
    s.add_argument("out")
    s.add_argument("--from", dest="sources", nargs="+", required=True, help="your footage (its colour is measured)")
    s.add_argument("--strength", type=float, default=0.8, help="0..1, how far to move towards the reference")
    s.add_argument("--size", type=int, default=33)
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_lut)

    s = sub.add_parser("render", help="render an edit plan")
    s.add_argument("plan")
    s.add_argument("out")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_render)

    s = sub.add_parser("compare", help="how close a result is to the reference")
    s.add_argument("reference")
    s.add_argument("result")
    s.set_defaults(fn=cmd_compare)
    return p


def main(argv=None):
    args = build().parse_args(argv)
    try:
        args.fn(args)
    except Problem as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
