#!/usr/bin/env python3
"""Generate crawlable static pages for search engines from the reel JSON.
Run after changing any reel content:  python3 scripts/build-seo.py
Writes: learn/index.html, learn/<ID>.html, sitemap.xml, robots.txt"""
import json, html, re, os, datetime
ROOT = os.path.join(os.path.dirname(__file__), '..')
SITE = 'https://lkgschool.in'
os.chdir(ROOT)
m = json.load(open('data/manifest.json'))
TRACK = {'python': ('Python', 'for C# / .NET developers'), 'genai': ('Generative AI', 'for software architects'), 'agentic': ('Agentic AI', 'for software architects')}
today = datetime.date.today().isoformat()
esc = lambda s: html.escape(s, quote=True)
plain = lambda s: re.sub(r'\*\*?|`', '', s)

def inline(s):
    s = esc(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
    return s

def md(src):
    out, para, lst, tbl = [], [], False, None
    def flush():
        nonlocal para
        if para: out.append('<p>' + inline(' '.join(para)) + '</p>'); para = []
    def close_list():
        nonlocal lst
        if lst: out.append('</ul>'); lst = False
    def flush_tbl():
        nonlocal tbl
        if tbl:
            out.append('<table><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in tbl[0]) + '</tr>' +
                       ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in tbl[1:]) + '</table>')
            tbl = None
    fence = None
    for raw in src.strip().split('\n'):
        line = raw.rstrip()
        if line.lstrip().startswith('```'):          # fenced code block
            if fence is None: flush(); close_list(); flush_tbl(); fence = []
            else: out.append('<pre><code>' + esc('\n'.join(fence)) + '</code></pre>'); fence = None
            continue
        if fence is not None: fence.append(raw); continue
        if not line.strip(): flush(); close_list(); flush_tbl(); continue
        if line.startswith('# '): flush(); close_list(); flush_tbl(); continue  # page already has its h1
        if line.startswith('## '): flush(); close_list(); flush_tbl(); out.append(f'<h2>{inline(line[3:])}</h2>'); continue
        if line.startswith('- '):
            flush(); flush_tbl()
            if not lst: out.append('<ul>'); lst = True
            out.append(f'<li>{inline(line[2:])}</li>'); continue
        if line.startswith('> '): flush(); close_list(); flush_tbl(); out.append(f'<blockquote>{inline(line[2:])}</blockquote>'); continue
        if line.startswith('|') and line.endswith('|'):
            flush(); close_list()
            cells = [c.strip() for c in line[1:-1].split('|')]
            if all(re.fullmatch(r':?-+:?', c) for c in cells): continue
            tbl = (tbl or []) + [cells]; continue
        flush_tbl(); close_list(); para.append(line.strip())
    flush(); close_list(); flush_tbl()
    return '\n'.join(out)

def page(title, desc, path, body, ld):
    return f'''<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:type" content="article"><meta property="og:site_name" content="LKG School">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{SITE}{path}"><meta property="og:image" content="{SITE}/img/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/learn.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head><body><main>
{body}
<footer><a href="/">LKG School</a> · <a href="/learn/">Full course</a> · <a href="mailto:info@lkgschool.in">info@lkgschool.in</a></footer>
</main></body></html>
'''

reels = m['reels']
stage_of = {rid: s['name'] for s in m['stages'] for rid in s['reels']}
urls = [('/', '1.0'), ('/learn/', '0.9')]
os.makedirs('learn', exist_ok=True)
for i, meta in enumerate(reels):
    try: r = json.load(open(meta['file']))
    except Exception: continue
    tname, tfor = TRACK.get(r['track'], (r['track'].title(), ''))
    stage = re.sub(r'^\d+\.\s*', '', stage_of.get(r['id'], r.get('stage', '')))
    title = f"{r['topic']} — {tname} {tfor} | LKG School"
    desc = f"{plain(r['hook'])} Learn {r['topic']} ({', '.join(r['chapters'][:4])}) in a short animated reel with notes, recap and quiz."
    if len(desc) > 300: desc = desc[:297] + '…'
    path = f"/learn/{r['id']}.html"
    prev_ = reels[i - 1] if i > 0 else None
    next_ = reels[i + 1] if i + 1 < len(reels) else None
    code = ''
    if r.get('code'):
        code = f"<h2>Code: {esc(r['code'].get('title',''))}</h2><pre><code>{esc(r['code'].get('body',''))}</code></pre>"
    body = f'''<nav class="crumbs"><a href="/learn/">Course</a> › {esc(stage)} › Reel {r['num']}</nav>
<h1>{esc(r['topic'])}</h1>
<p class="lede">{inline(r['hook'])}</p>
<a class="cta" href="/?reel={r['id']}">▶ Watch this reel</a>
<h2>What you'll learn</h2><ol>{''.join(f'<li>{esc(c)}</li>' for c in r['chapters'])}</ol>
<h2>Remember this</h2><ul>{''.join(f'<li>{inline(x)}</li>' for x in r['recap'])}</ul>
<section class="notes">{md(r.get('notes',''))}</section>
{code}
<nav class="pn">{f'<a href="/learn/{prev_["id"]}.html">← {esc(prev_["topic"])}</a>' if prev_ else '<span></span>'}{f'<a href="/learn/{next_["id"]}.html">{esc(next_["topic"])} →</a>' if next_ else ''}</nav>'''
    ld = [{"@context": "https://schema.org", "@type": "LearningResource", "name": r['topic'], "description": desc,
           "url": SITE + path, "learningResourceType": "Video lesson", "educationalLevel": "Intermediate",
           "teaches": r['chapters'], "inLanguage": "en", "isAccessibleForFree": True,
           "provider": {"@type": "Organization", "name": "LKG School", "url": SITE}},
          {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": "Course", "item": SITE + "/learn/"},
              {"@type": "ListItem", "position": 2, "name": r['topic'], "item": SITE + path}]}]
    open(f"learn/{r['id']}.html", 'w').write(page(title, desc, path, body, ld))
    urls.append((path, '0.8'))

# course index
parts = []
for s in m['stages']:
    items = ''.join(f'<li><a href="/learn/{rid}.html">{esc(next(x["topic"] for x in reels if x["id"] == rid))}</a></li>' for rid in s['reels'])
    parts.append(f'<h2>{esc(s["name"])}</h2><ol>{items}</ol>')
body = f'''<h1>LKG School — GenAI Architect Path</h1>
<p class="lede">A free, mobile-first course that takes a <strong>.NET / C# developer</strong> to <strong>GenAI architect</strong>: Python, LLMs, RAG, embeddings, agents and MCP — in 80 short animated reels with voiceover, notes, recaps and quizzes.</p>
<a class="cta" href="/">▶ Start learning</a>
{''.join(parts)}'''
ld = {"@context": "https://schema.org", "@type": "Course", "name": "GenAI Architect Path",
      "description": "From .NET developer to GenAI architect: Python, generative AI and agentic AI in 80 short reels.",
      "url": SITE + "/learn/", "inLanguage": "en", "isAccessibleForFree": True,
      "provider": {"@type": "Organization", "name": "LKG School", "url": SITE},
      "hasCourseInstance": {"@type": "CourseInstance", "courseMode": "online", "courseWorkload": "PT10H"},
      "offers": {"@type": "Offer", "price": "0", "priceCurrency": "INR", "category": "Free"}}
open('learn/index.html', 'w').write(page('Free GenAI Architect Course for .NET Developers — Python, LLMs, Agents | LKG School',
     'Free course: go from .NET/C# developer to GenAI architect. Python, LLMs, RAG, embeddings, agents and MCP in 80 short animated reels with notes and quizzes.',
     '/learn/', body, ld))

open('sitemap.xml', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    ''.join(f'  <url><loc>{SITE}{u}</loc><lastmod>{today}</lastmod><priority>{p}</priority></url>\n' for u, p in urls) + '</urlset>\n')
open('robots.txt', 'w').write(f'User-agent: *\nAllow: /\nDisallow: /data/audio/\n\nSitemap: {SITE}/sitemap.xml\n')
print(f'wrote {len(urls) - 2} reel pages, learn/index.html, sitemap.xml ({len(urls)} urls), robots.txt')
