#!/usr/bin/env python3
"""Generate LKG voiceover mp3s with a cloned voice via a local VoiceStudio (OpenAI-compatible /v1/audio/speech).
Same clip names as gen_voice_gemini.py (hook, s<i>, recap, quizN_q/_why, _fx/*), so output is a drop-in for data/audio.
Resumable: skips clips that already exist. Plain text only (no [bracket] tags - engines may read them aloud).

  python3 gen_voice_studio.py --reels PY-01 --dry                 # list clips + text
  python3 gen_voice_studio.py --reels PY-01                       # -> data/audio-voicestudio/
  python3 gen_voice_studio.py --all --voice 37fb133a --speed 1.0
  # stock male voice (KittenTTS "Bruno"), loud, for a whole track; leaves the shared _fx clips alone
  python3 gen_voice_studio.py --track python --model kittentts --voice expr-voice-3-m --speed 1.1 --loud --no-fx --out data/audio --force

Flags: --url (default http://127.0.0.1:3900), --model (voxcpm2), --voice (profile id), --speed, --retries.
Pronunciation fixes live in SPEECH below.
"""
import argparse, json, os, re, subprocess, sys, tempfile, time
import urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("--reels", nargs="*", default=[], help="reel ids, e.g. PY-01")
ap.add_argument("--all", action="store_true")
ap.add_argument("--track", help="all reels of a track, e.g. python")
ap.add_argument("--skip-listed", help="text file of mp3 paths to skip (resume a --force run)")
ap.add_argument("--no-fx", action="store_true", help="skip the shared _fx/correct and _fx/notquite clips")
ap.add_argument("--loud", action="store_true", help="loudness-normalise each clip to -14 LUFS")
ap.add_argument("--out", default="data/audio-voicestudio")
ap.add_argument("--url", default=os.environ.get("VOICESTUDIO_URL", "http://127.0.0.1:3900"))
ap.add_argument("--model", default="voxcpm2", help="VoiceStudio engine id")
ap.add_argument("--voice", "--profile", dest="voice", default="37fb133a", help="voice profile id (Sharad Normal)")
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--steps", type=int, default=None, help="VoxCPM2 diffusion steps (engine default 10; more = cleaner but slower)")
ap.add_argument("--cfg", type=float, default=None, help="guidance scale (engine default 2.0)")
ap.add_argument("--retries", type=int, default=4)
ap.add_argument("--only", nargs="*", default=[], help="only these clip names, e.g. hook s3 _fx/correct")
ap.add_argument("--style", action="store_true", help="add per-clip style instructions (off by default: plain cloning sounds closest to the reference voice)")
ap.add_argument("--force", action="store_true", help="regenerate clips even if the mp3 exists")
ap.add_argument("--dry", action="store_true", help="list clips and text, call nothing")
args = ap.parse_args()

strip = lambda s: re.sub(r"\*\*", "", s).strip()

def clips_for(reel):
    """yield (filename, text) for every spoken line of a reel (mirrors gen_voice_gemini.py)."""
    out = [("hook", strip(reel["hook"]))]
    for i, sc in enumerate(reel["scenes"]):
        if not sc.get("narration"):
            continue
        out.append((f"s{i}", strip(sc["narration"])))
    r = [strip(x) for x in reel["recap"]]
    say = "Remember these. First: " + r[0] + ". Also: " + r[1]
    if len(r) > 2 and r[2]:
        say += ". And finally: " + r[2]
    say += ". Now — a quick check."
    out.append(("recap", say))
    for qi, q in enumerate(reel.get("quiz", [])):
        out.append((f"quiz{qi}_q", strip(q["q"])))
        out.append((f"quiz{qi}_why", strip(q["why"])))
    return out

FX = [("_fx/correct", "Correct!"), ("_fx/notquite", "Not quite.")]

# Expression: VoxCPM2 takes a style instruction as a "(control)text" prefix (sent as `instructions`), so nothing is
# read aloud. One per clip kind; tune these after listening.
BASE = "a friendly young Indian developer explaining to a friend, natural and conversational"
STYLE = {
    "hook": BASE + ", warm and inviting, a little energetic, clear pauses between sentences",
    "narr": BASE + ", relaxed medium pace, upbeat, slight emphasis on key words, short pauses between sentences",
    "recap": BASE + ", clear and steady, slightly slower, pause between the three points, cheerful on the last line",
    "quiz_q": BASE + ", curious and engaging, rising tone on the question",
    "quiz_why": BASE + ", calm and explanatory, reassuring",
    "correct": BASE + ", happy and cheerful",
    "notquite": BASE + ", gentle and kind, encouraging",
}

def style_for(fname):
    if fname in STYLE:
        return STYLE[fname]
    if fname.startswith("_fx/"):
        return STYLE[fname[4:]]
    if fname.endswith("_q"):
        return STYLE["quiz_q"]
    if fname.endswith("_why"):
        return STYLE["quiz_why"]
    return STYLE["narr"]

# per-word speech replacements, applied in order (tune after listening)
SPEECH = [
    (r"pyproject\.toml", "pie project dot toml"),
    (r"uv\.lock", "uv dot lock"),
    (r"==", " double equals "),
    (r"`", ""),
    (r" \+ ", " plus "),
    (r" — ", ", "),                      # em dash -> comma pause
    (r"\. (Also|And finally|Now)\b", r"... \1"),   # recap: longer pause between the three points
]

def speakable(text):
    for pat, rep in SPEECH:
        text = re.sub(pat, rep, text)
    return re.sub(r"[ \t]+", " ", text).strip()

def tts(text, style):
    req_body = {"model": args.model, "input": text, "voice": args.voice, "speed": args.speed, "response_format": "wav"}
    if args.steps:
        req_body["num_step"] = args.steps
    if args.cfg:
        req_body["guidance_scale"] = args.cfg
    if style and args.style:
        req_body["instructions"] = style
    body = json.dumps(req_body).encode()
    last = None
    for attempt in range(args.retries):
        try:
            req = urllib.request.Request(args.url + "/v1/audio/speech", body, {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=900) as r:
                data = r.read()
            if len(data) < 2000:
                raise RuntimeError(f"suspiciously small audio ({len(data)} bytes)")
            return data
        except (urllib.error.URLError, RuntimeError, TimeoutError) as e:
            last = getattr(e, "read", lambda: b"")() or e
            wait = min(60, 4 * 2 ** attempt)
            print(f"  error {str(last)[:200]}, retry in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"gave up: {str(last)[:200]}")

def to_mp3(audio, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    af = ["-af", "loudnorm=I=-14:TP=-1:LRA=7"] if args.loud else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "-", *af, "-ac", "1",
                    "-codec:a", "libmp3lame", "-b:a", "96k", path], input=audio, check=True)

def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0

def main():
    metas = json.load(open("data/manifest.json"))["reels"]
    if args.track:
        metas = [m for m in metas if m.get("track") == args.track]
    elif not args.all:
        metas = [m for m in metas if m.get("id") in args.reels or any(x in m["file"] for x in args.reels)]
        if not metas:
            sys.exit("no matching reels; pass --reels PY-01 or --all")
    todo = []
    for name, text in ([] if args.no_fx else FX):
        p = os.path.join(args.out, name + ".mp3")
        if args.force or not os.path.exists(p):
            todo.append((p, text, style_for(name)))
    for meta in metas:
        d = json.load(open(meta["file"].replace("./", "")))
        for fname, text in clips_for(d):
            p = os.path.join(args.out, d["id"], fname + ".mp3")
            if args.force or not os.path.exists(p):
                todo.append((p, speakable(text), style_for(fname)))
    if args.skip_listed:
        skip = set(open(args.skip_listed).read().split())
        todo = [t for t in todo if t[0] not in skip]
    if args.only:
        todo = [t for t in todo if any(t[0].endswith(f"/{o}.mp3") for o in args.only)]
    print(f"{len(todo)} clips, {sum(len(t) for _, t, _ in todo)} chars -> {args.out} "
          f"(engine {args.model}, voice {args.voice}, speed {args.speed})", flush=True)
    if args.dry:
        for p, t, st in todo:
            print(f"- {p} [{st[len(BASE) + 2:]}]: {t}")
        return
    report = []
    for n, (path, text, style) in enumerate(todo, 1):
        t0 = time.time()
        try:
            to_mp3(tts(text, style), path)
            secs, dur = time.time() - t0, duration(path)
            cps = len(text) / dur if dur else 0
            flag = " SUSPICIOUS" if dur and not 8 <= cps <= 22 else ""
            print(f"[{n}/{len(todo)}] {path} {secs:.1f}s gen, {dur:.1f}s audio, {cps:.1f} chars/s{flag}", flush=True)
            report.append((path, secs, dur, cps))
        except Exception as e:
            print(f"[{n}/{len(todo)}] FAILED {path}: {e}", flush=True)

main()
