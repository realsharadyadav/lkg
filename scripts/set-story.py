#!/usr/bin/env python3
"""Turn one scene of a reel into a `story` scene, touching ONLY that scene's text in the file
(everything else stays byte-identical, so diffs stay small).

  python3 scripts/set-story.py PY-02 3 story.json

story.json = {"h": 290, "actors": [...], "steps": [...]}  (optional "kicker" / "title" override the old ones).
The scene keeps its chapter, kicker, title, sub and narration; old items/cards/stages are dropped.
Then run: node scripts/check-story.js PY-02
"""
import json, re, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def inline(v):
    if isinstance(v, dict):
        return '{ ' + ', '.join(json.dumps(k, ensure_ascii=False) + ': ' + inline(x) for k, x in v.items()) + ' }' if v else '{}'
    if isinstance(v, list): return '[' + ', '.join(inline(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)

def scene_text(sc):
    pad = ' ' * 6
    lines = []
    for k, v in sc.items():
        if k in ('actors', 'steps'):
            lines.append(f'{pad}{json.dumps(k)}: [\n' + ',\n'.join(pad + '  ' + inline(x) for x in v) + f'\n{pad}]')
        else:
            lines.append(f'{pad}{json.dumps(k)}: {inline(v)}')
    return '    {\n' + ',\n'.join(lines) + '\n    }'

def main():
    rid, idx, src = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    path = os.path.join(root, 'data/reels', rid + '.json')
    raw = open(path, encoding='utf8').read()
    d = json.loads(raw)
    old = d['scenes'][idx]
    new_bits = json.load(open(src, encoding='utf8'))
    sc = {'type': 'story', 'chapter': old.get('chapter')}
    for k in ('kicker', 'title', 'sub'):
        v = new_bits.get(k, old.get(k))
        if v is not None: sc[k] = v
    sc['h'] = new_bits.get('h', 290)
    sc['actors'] = new_bits['actors']; sc['steps'] = new_bits['steps']
    sc['narration'] = old['narration']
    # locate scene idx's text span: scene objects start at "    {" and end at "    }" / "    },"
    lines = raw.split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('  "scenes": ['))
    n = -1; a = b = None
    for i in range(start + 1, len(lines)):
        if lines[i] == '    {':
            n += 1
            if n == idx: a = i
        if lines[i] in ('    }', '    },') and n == idx and a is not None:
            b = i; trailing = lines[i][5:]; break
    assert a is not None and b is not None, 'scene span not found'
    lines[a:b + 1] = (scene_text(sc) + trailing).split('\n')
    out = '\n'.join(lines)
    json.loads(out)                                     # must still be valid JSON
    open(path, 'w', encoding='utf8').write(out)
    print(f'{rid} scene {idx}: {old["type"]} -> story')

main()
