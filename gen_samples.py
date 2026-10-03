#!/usr/bin/env python3
"""Generate Kokoro voice samples from LKG reel 1 narration."""
import json, os
from kokoro import KPipeline
import soundfile as sf

d = json.load(open('data/reels/PY-01.json'))
texts = [
    ("hook", d['hook'].replace('**', '')),
    ("scene1", d['scenes'][0]['narration']),
]
# a mid-course style narration for a second text sample
d2 = json.load(open('data/reels/AG-01.json'))
texts.append(("agentic_sample", d2['scenes'][min(1, len(d2['scenes'])-1)]['narration']))

VOICES = ["af_heart", "af_bella", "am_adam", "af_nova"]
pipeline = KPipeline(lang_code='a')  # American English
os.makedirs('/tmp/tts-samples', exist_ok=True)

for name, text in texts:
    for v in VOICES:
        gen = pipeline(text, voice=v, speed=1.0)
        for i, (_, _, audio) in enumerate(gen):
            out = f"/tmp/tts-samples/{name}__{v}.wav"
            sf.write(out, audio, 24000)
            print(out, f"{os.path.getsize(out)/1024:.0f} KB")
            break
print("DONE")
