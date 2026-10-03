#!/usr/bin/env python3
"""Generate LKG voiceover mp3s with Kokoro (voice: am_adam).
Resumable: skips clips that already exist. Usage:
  python gen_voice.py <shard_idx> <num_shards>   # processes reels[idx % shards == shard]
"""
import json, os, sys, re, io

SHARD, SHARDS = int(sys.argv[1]), int(sys.argv[2])
VOICE = "am_adam"
ROOT = "data/audio"

strip = lambda s: re.sub(r"\*\*", "", s).strip()

def clips_for(reel):
    """yield (filename, text) for every spoken line of a reel."""
    out = [("hook", strip(reel["hook"]))]
    for i, sc in enumerate(reel["scenes"]):
        if not sc.get("narration"):
            continue                      # bridge-style scenes are silent in the player
        out.append((f"s{i}", strip(sc["narration"])))
    r = [strip(x) for x in reel["recap"]]
    say = "Remember these. First: " + r[0] + ". Also: " + r[1]
    if len(r) > 2 and r[2]:
        say += ". And finally: " + r[2]
    say += ". Now — a quick check."
    out.append(("recap", say))
    for qi, q in enumerate(reel.get("quiz", [])):
        out.append((f"quiz{qi}_q", strip(q["q"])))
        out.append((f"quiz{qi}_why", strip(q["why"])))   # prefix ("Correct!") is a shared global clip
    return out

FX = [("_fx/correct", "Correct!"), ("_fx/notquite", "Not quite.")]

def main():
    import os
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    import torch
    torch.set_num_threads(1)
    from kokoro import KPipeline
    import numpy as np, lameenc, soundfile as sf

    manifest = json.load(open("data/manifest.json"))
    reels = manifest["reels"]
    mine = [r for i, r in enumerate(reels) if i % SHARDS == SHARD]

    # count total work & what's missing
    todo = []
    for name, text in FX:
        path = os.path.join(ROOT, name + ".mp3")
        if not os.path.exists(path):
            todo.append(("_fx", path, text))
    for meta in mine:
        d = json.load(open(meta["file"].replace("./", "")))
        ddir = os.path.join(ROOT, d["id"])
        for fname, text in clips_for(d):
            path = os.path.join(ddir, fname + ".mp3")
            if not os.path.exists(path):
                todo.append((d["id"], path, text))

    print(f"[shard {SHARD}/{SHARDS}] {len(mine)} reels, {len(todo)} clips to generate", flush=True)
    if not todo:
        print(f"[shard {SHARD}] nothing to do", flush=True)
        return

    try:
        pipe = KPipeline(lang_code="a", device="mps")   # Apple Silicon Metal GPU
    except Exception:
        pipe = KPipeline(lang_code="a")
    enc0 = None
    done = 0
    for rid, path, text in todo:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        chunks = [audio for _, _, audio in pipe(text, voice=VOICE, speed=1.0)]
        wav = np.concatenate(chunks)
        pcm = (np.clip(wav, -1.0, 1.0) * 32767).astype(np.int16)  # lameenc needs int16 PCM
        enc = lameenc.Encoder()
        enc.set_bit_rate(48)
        enc.set_in_sample_rate(24000)
        enc.set_channels(1)
        enc.set_out_sample_rate(24000)
        mp3 = enc.encode(pcm.tobytes()) + enc.flush()
        with open(path, "wb") as f:
            f.write(mp3)
        done += 1
        if done % 10 == 0:
            print(f"[shard {SHARD}] {done}/{len(todo)}", flush=True)
    print(f"[shard {SHARD}] DONE {done}/{len(todo)}", flush=True)

main()
