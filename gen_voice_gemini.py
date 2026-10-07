#!/usr/bin/env python3
"""Generate LKG voiceover mp3s with Gemini TTS (REST, no SDK).
Same clip names as gen_voice.py (hook, s<i>, recap, quizN_q/_why, _fx/*), so output is a drop-in for data/audio.
Resumable: skips clips that already exist.

  export GEMINI_API_KEY=...            # Google AI Studio key (never commit it)
  python3 gen_voice_gemini.py --reels PY-01              # test one reel -> data/audio-gemini/
  python3 gen_voice_gemini.py --reels PY-01 PY-02 --voice Kore
  python3 gen_voice_gemini.py --all --out data/audio     # full run, overwrites Kokoro clips

Env/flags: --model (default gemini-3.1-flash-tts-preview), --voice (default Kore), --style (spoken-direction prefix).
"""
import argparse, base64, json, os, re, subprocess, sys, time
import requests

ap = argparse.ArgumentParser()
ap.add_argument("--reels", nargs="*", default=[], help="reel ids, e.g. PY-01")
ap.add_argument("--all", action="store_true")
ap.add_argument("--out", default="data/audio-gemini")
ap.add_argument("--model", default=os.environ.get("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview"))
ap.add_argument("--voice", default="Kore")
ap.add_argument("--style", default="Say in a warm, clear, upbeat voice, like a friendly teacher explaining to a developer: ")
ap.add_argument("--sleep", type=float, default=1.0, help="seconds between requests (free-tier rate limits)")
ap.add_argument("--dry", action="store_true", help="list clips and character count, call nothing")
args = ap.parse_args()

strip = lambda s: re.sub(r"\*\*", "", s).strip()

def clips_for(reel):
    """yield (filename, text) for every spoken line of a reel (mirrors gen_voice.py)."""
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

def tts(text, key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{args.model}:generateContent"
    body = {
        "contents": [{"parts": [{"text": args.style + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": args.voice}}},
        },
    }
    for attempt in range(6):
        r = requests.post(url, headers={"x-goog-api-key": key}, json=body, timeout=120)
        if r.status_code in (429, 500, 503):
            wait = min(60, 4 * 2 ** attempt)
            print(f"  {r.status_code}, retry in {wait}s", flush=True)
            time.sleep(wait)
            continue
        r.raise_for_status()
        parts = r.json()["candidates"][0]["content"]["parts"]
        for p in parts:
            if "inlineData" in p:
                return base64.b64decode(p["inlineData"]["data"])      # raw PCM s16le, 24 kHz mono
        raise RuntimeError("no audio in response (model may have returned text only)")
    raise RuntimeError("gave up after retries")

def pcm_to_mp3(pcm, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "-",
                    "-codec:a", "libmp3lame", "-b:a", "96k", path], input=pcm, check=True)

def main():
    manifest = json.load(open("data/manifest.json"))
    metas = manifest["reels"]
    if not args.all:
        metas = [m for m in metas if m.get("id") in args.reels or any(x in m["file"] for x in args.reels)]
        if not metas:
            sys.exit("no matching reels; pass --reels PY-01 or --all")
    todo = []
    for name, text in FX:
        p = os.path.join(args.out, name + ".mp3")
        if not os.path.exists(p):
            todo.append((p, text))
    for meta in metas:
        d = json.load(open(meta["file"].replace("./", "")))
        for fname, text in clips_for(d):
            p = os.path.join(args.out, d["id"], fname + ".mp3")
            if not os.path.exists(p):
                todo.append((p, text))
    chars = sum(len(t) for _, t in todo)
    print(f"{len(todo)} clips, {chars} chars -> {args.out} (model {args.model}, voice {args.voice})", flush=True)
    if args.dry or not todo:
        return
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("set GEMINI_API_KEY first")
    for n, (path, text) in enumerate(todo, 1):
        try:
            pcm_to_mp3(tts(text, key), path)
            print(f"[{n}/{len(todo)}] {path}", flush=True)
        except Exception as e:
            print(f"[{n}/{len(todo)}] FAILED {path}: {e}", flush=True)
        time.sleep(args.sleep)

main()
