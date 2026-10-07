"""Build 2 design proposal: web app (PWA) on laptops, public web pages, first-run fixes, share card,
Agora backing, 'What could go wrong', and Group 2 screens. Run: python3 design/gen/build2.py"""
import re, sys, os, html
sys.path.insert(0, os.path.dirname(__file__))
import b2core
from b2core import ITEMS, SECTIONS, CSS, logo
import b2a, b2b, b2c, b2d  # noqa: F401  (register items in order)

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'build2-screens.html')

BANNED = ['wallet', 'address', 'gas', 'token', 'chain', 'transaction', 'blockchain', 'crypto', 'sign']
ALLOW = ['sign out', 'sign in to']


def visible_text(h):
    h = re.sub(r'<svg.*?</svg>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    return html.unescape(h)


problems = []
for it in ITEMS:
    t = visible_text(it['frame']('light')).lower()
    for a in ALLOW:
        t = t.replace(a, '')
    for w in BANNED:
        if re.search(r'\b' + w + r's?\b', t):
            problems.append((it['n'], w))
if problems:
    print('BANNED WORDS:', problems)

nums = [it['n'] for it in ITEMS]
assert len(nums) == len(set(nums)), 'duplicate item numbers'


def figure(it, theme, label):
    k = it['kind']
    f = it['frame'](theme)
    if k == 'phone':
        return f'<figure><figcaption>{label}</figcaption>{f}</figure>'
    if k == 'lap':
        return (f'<figure><figcaption>{label} · 1440 × 900<button class="zbtn" type="button">Actual size</button></figcaption>'
                f'<div class="lapw" data-w="1440">{f}</div></figure>')
    _, w, mx = k
    return (f'<figure><figcaption>{label}<button class="zbtn" type="button">Actual size</button></figcaption>'
            f'<div class="lapw" data-w="{w}" data-max="{mx}">{f}</div></figure>')


def shot(it):
    meta = ''.join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in (('Entry', it['entry']), ('Exit', it['exit']), ('States', it['states'])) if b)
    g2 = '<span class="g2t">Group 2</span>' if it['g2'] else ''
    k = it['kind']
    l1, l2 = it['labels']
    if k == 'phone':
        frames = f'<div class="pair">{figure(it, "light", l1)}{figure(it, "dark", l2)}</div>'
        wide = ''
    elif k == 'lap':
        frames = f'<div class="lstack">{figure(it, "light", l1)}{figure(it, "dark", l2)}</div>'
        wide = ' wide'
    elif k[1] * k[2] > 900:
        frames = f'<div class="lstack">{figure(it, "light", l1)}{figure(it, "dark", l2)}</div>'
        wide = ' wide'
    else:
        frames = f'<div class="cardrow">{figure(it, "light", l1)}{figure(it, "dark", l2)}</div>'
        wide = ' wide'
    return (f'<article class="shot{wide}" id="s{it["n"]}"><header class="sh"><span class="num">{it["n"]}</span><h3>{it["title"]}{g2}</h3></header>'
            f'<p class="cap">{it["purpose"]}</p><dl class="meta">{meta}</dl>{frames}</article>')


sections = []
for s in SECTIONS:
    its = [it for it in ITEMS if it['sec'] == s['k']]
    rng = f'{its[0]["n"]}–{its[-1]["n"]}' if its else ''
    g2 = ' <span class="badge-g2">Group 2 · design now, build later</span>' if s['g2'] else ''
    note = f'<div class="note secnote">{s["note"]}</div>' if s.get('note') else ''
    sections.append(f'<section class="flow" id="flow-{s["k"]}"><div class="fh"><span class="fl">{s["k"]}</span><div><h2>{s["name"]}{g2}</h2>'
                    f'<p>{s["desc"]} <span class="fn">Items {rng}</span></p></div></div>{note}'
                    f'<div class="grid">{"".join(shot(it) for it in its)}</div></section>')

idx = ''.join(f'<a href="#flow-{s["k"]}" data-f="{s["k"]}"><b>{s["k"]}</b>{s["name"]}</a>' for s in SECTIONS)

app_css = open(os.path.join(HERE, 'app.css')).read() + open(os.path.join(HERE, 'extra.css')).read()
page_css = open(os.path.join(HERE, 'page.css')).read()


def dup_fixed(css):
    """Every rule that targets .phone.light / .phone.dark also targets .fx.light / .fx.dark (laptop frames, cards)."""
    def rep(m):
        sel = m.group(1)
        if '.phone.light' in sel or '.phone.dark' in sel:
            parts = [p.strip() for p in sel.split(',')]
            extra = [p.replace('.phone.light', '.fx.light').replace('.phone.dark', '.fx.dark') for p in parts if '.phone.' in p]
            return ','.join(parts + extra) + '{'
        return m.group(0)
    return re.sub(r'([^{}]+)\{', rep, css)


app_css = dup_fixed(app_css)

total = len(ITEMS)
n_g2 = sum(1 for it in ITEMS if it['g2'])
doc = f'''<title>Plans Build 2 Screens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Roboto:wght@400;500&display=swap">
<style>
{page_css}
{app_css}
{CSS}
</style>
<div class="page">
<header class="intro wrap">
  <div class="brandrow">{logo(26)}<span class="tag">Build 2 · design gate · v1 · 7 Oct 2026</span></div>
  <h1>Plans in the browser, and everything the first three minutes taught us.</h1>
  <p class="lede">This page proposes every new or changed screen for Build 2: the web app on laptops, the public pages people reach from a shared link, the first-run fixes, the shareable settle-up, the Agora backing panel, an honest “What could go wrong” screen, and the Group 2 screens to design now and build later. <b>{total}</b> numbered items, each drawn light and dark.</p>
  <div class="how">
    <div><b>Review by number.</b> Items run 101–{nums[-1]} so they never clash with the approved app screens 01–60. Reply with something like “approve all except 109, 143”. Items marked <span class="g2t" style="margin:0">Group 2</span> ({n_g2}) are designed now and built later.</div>
    <div><b>Same design system.</b> Tokens, fonts, components and phone frames are imported unchanged from the approved generator. Laptop frames are 1440 × 900 browser windows with the same fixed light and dark palettes. They scale down to fit; “Actual size” shows them at 100 %.</div>
    <div><b>Phones keep their layouts.</b> Below 760 px wide the web app uses the approved phone screens 01–60 exactly; 119–121 confirm it in mobile Chrome and Safari. Only new phone screens are drawn here.</div>
    <div><b>Words.</b> App copy never uses the technical money words. “Proof” links (and the “Check this rate” sheet, Group 2) are the only technical surface. Rules follow <code>docs/protocol.md</code> (Balanced: $25 now, $25–$200 one OK, over $200 most of the group, $150 a day each).</div>
  </div>
</header>
<nav class="idx" aria-label="Sections"><div class="idxin">{idx}</div><button class="themetog" type="button" aria-label="Switch page theme">◐</button></nav>
<main class="wrap">
{"".join(sections)}
<footer class="foot"><p>Plans · Build 2 screens v1 · {total} items · light and dark. Static mock-ups; nothing here is live. Sample values (build size, SHA-256, reserve report dates, rate round numbers) are placeholders and are labelled as such in captions.</p></footer>
</main>
</div>
<script>
(function(){{
  function fit(){{
    [].forEach.call(document.querySelectorAll('.lapw'),function(w){{
      var f=w.firstElementChild,nw=+w.dataset.w||1440,mx=+(w.dataset.max||1);
      f.style.zoom=w.classList.contains('full')?1:Math.min(mx,(w.clientWidth-2)/nw);
    }});
  }}
  addEventListener('resize',fit);fit();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
  [].forEach.call(document.querySelectorAll('.zbtn'),function(b){{
    b.addEventListener('click',function(){{var w=b.closest('figure').querySelector('.lapw');w.classList.toggle('full');b.textContent=w.classList.contains('full')?'Fit':'Actual size';fit();}});
  }});
  var links=[].slice.call(document.querySelectorAll('.idx a'));
  var map={{}};links.forEach(function(a){{map[a.dataset.f]=a;}});
  if('IntersectionObserver' in window){{
    var io=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{links.forEach(function(a){{a.classList.remove('on')}});var a=map[e.target.id.slice(5)];if(a){{a.classList.add('on');try{{a.scrollIntoView({{block:'nearest',inline:'nearest'}})}}catch(_){{}}}}}}}})}},{{rootMargin:'-45% 0px -50% 0px'}});
    document.querySelectorAll('.flow').forEach(function(s){{io.observe(s)}});
  }}
  var r=document.documentElement,b=document.querySelector('.themetog');
  b.addEventListener('click',function(){{var dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';}});
}})();
</script>
'''
open(OUT, 'w').write(doc)
print('items', total, 'group2', n_g2, 'bytes', len(doc.encode()))
