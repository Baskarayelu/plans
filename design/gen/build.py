import re, sys, os, html
sys.path.insert(0, os.path.dirname(__file__))
from base import SCREENS, phone, W, ic, logo
import s1, s2, s3, s4

HERE = os.path.dirname(__file__)
OUT = '/Users/jagadeesh/boss/grants/monad/plans/design/app-screens.html'

FLOWS = [
 ('A', 'Start', 'Create an account or come back to one with a passkey. No passwords, nothing to write down.'),
 ('B', 'Home & account', 'Your plans at a glance, plus your own balance outside any plan.'),
 ('C', 'Create & invite', 'Set up a plan in two steps, pick rules in plain words, and share one link.'),
 ('D', 'Join', 'What a friend sees when they open the link, and the moment they are in.'),
 ('E', 'Plan', 'The pot, your position, budgets and a live feed of every spend.'),
 ('F', 'Spend', 'Paying from the pot. The rule preview tells you what will happen before you confirm.'),
 ('G', 'Approve', 'Bigger spends wait for friends. One tap to approve, a reason to reject.'),
 ('H', 'Receipts & disputes', 'Every spend has a receipt, and any spend can be questioned for a short window.'),
 ('I', 'Safety', 'Pause the pot, change rules by vote, or leave with your share.'),
 ('J', 'Ending', 'Review, settle up in one tap, and keep a memory of the plan.'),
 ('K', 'Send', 'Cross-border sending between people. The flow for the payments demo video.'),
 ('L', 'Activity & You', 'Everything that needs you, your profile and your key.'),
 ('M', 'Judge demo', 'A guided settle-up with three demo friends, so judges can feel the whole loop in two minutes.'),
 ('N', 'System states', 'Offline, errors and loading.'),
]

BANNED = ['wallet', 'address', 'gas', 'token', 'chain', 'transaction', 'blockchain', 'crypto', 'sign']
ALLOW = ['sign out', 'sign in to']

def visible_text(h):
    h = re.sub(r'<svg.*?</svg>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    return html.unescape(h)

problems = []
for s in SCREENS:
    t = visible_text(s['body'] + s['over']).lower()
    for a in ALLOW:
        t = t.replace(a, '')
    for w in BANNED:
        if re.search(r'\b' + w + r's?\b', t):
            problems.append((s['n'], w))
if problems:
    print('BANNED WORDS:', problems)

def shot(s):
    meta = ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in (('Entry', s['entry']), ('Exit', s['exit']), ('States', s['states'])))
    return (f'<article class="shot" id="s{s["n"]}"><header class="sh"><span class="num">{s["n"]}</span><h3>{s["title"]}</h3></header>'
            f'<p class="cap">{s["purpose"]}</p><dl class="meta">{meta}</dl>'
            f'<div class="pair"><figure><figcaption>Light</figcaption>{phone(s, "light")}</figure>'
            f'<figure><figcaption>Dark</figcaption>{phone(s, "dark")}</figure></div></article>')

sections = []
for k, name, desc in FLOWS:
    ss = [s for s in SCREENS if s['flow'] == k]
    nums = ', '.join(s['n'] for s in ss)
    sections.append(f'<section class="flow" id="flow-{k}"><div class="fh"><span class="fl">{k}</span><div><h2>{name}</h2>'
                    f'<p>{desc} <span class="fn">Screens {nums}</span></p></div></div>'
                    f'<div class="grid">{"".join(shot(s) for s in ss)}</div></section>')

idx = ''.join(f'<a href="#flow-{k}" data-f="{k}"><b>{k}</b>{name}</a>' for k, name, _ in FLOWS)

def sw(name, hexv, note=''):
    return f'<div class="swt"><i style="background:{hexv}"></i><div><b>{name}</b><span>{hexv}</span>{f"<em>{note}</em>" if note else ""}</div></div>'

LIGHT = [('bg', '#F4F6F1', 'pale sage white'), ('surface', '#FFFFFF', ''), ('surface-2', '#EAEFE7', ''), ('ink', '#10231B', 'deep pine'),
         ('muted', '#5A6B62', ''), ('line', '#D9E0D5', ''), ('accent', '#F5B83D', 'marigold · primary'), ('on-accent', '#10231B', ''),
         ('pos', '#1F7A55', 'owed to you'), ('neg', '#B8432F', 'you owe · blocked'), ('info', '#2B5F8A', '')]
DARK = [('bg', '#0C1511', ''), ('surface', '#14201A', ''), ('surface-2', '#1B2A22', ''), ('ink', '#E8F0EA', ''), ('muted', '#93A69A', ''),
        ('line', '#26362D', ''), ('accent', '#F5B83D', ''), ('on-accent', '#10231B', ''), ('pos', '#4CC38A', ''), ('neg', '#FF7A66', ''), ('info', '#7FB2DE', '')]

tokens = (
 '<div class="tokgrid">'
 f'<div class="tok"><h4>App · light</h4><div class="sws">{"".join(sw(*x) for x in LIGHT)}</div></div>'
 f'<div class="tok"><h4>App · dark</h4><div class="sws">{"".join(sw(*x) for x in DARK)}</div></div>'
 '<div class="tok"><h4>Wristband colours (one per plan)</h4><div class="bands">'
 + ''.join(f'<div class="wbs" style="--w:{v}"><span>{k}</span><span>{v}</span><i></i></div>' for k, v in W.items())
 + '</div><p class="small">Stripe overlay at −55°, Plex Mono label, snap dot on the right. Dark ink text on every band (all pass 4.5:1).</p></div>'
 '<div class="tok wide"><h4>Type</h4><div class="types">'
 '<div><span class="tlab">Display · Bricolage Grotesque 800 · 34</span><span style="font:800 34px/1.05 \'Bricolage Grotesque\';letter-spacing:-.035em">$446.00 in the pot</span></div>'
 '<div><span class="tlab">Display · 700 · 28 / 22</span><span style="font:750 28px/1.1 \'Bricolage Grotesque\';letter-spacing:-.03em">Lisbon, 12–16 Oct</span>'
 '<span style="font:700 22px/1.2 \'Bricolage Grotesque\';letter-spacing:-.02em">Settle up in one tap</span></div>'
 '<div><span class="tlab">Body · Figtree 400–600 · 17 / 15 / 13</span><span style="font:500 17px Figtree">Sam paid $36 · Dinner at Taberna</span>'
 '<span style="font:400 15px Figtree">Spends up to $50 go through straight away.</span><span style="font:400 13px Figtree;color:var(--p-muted)">Your share $12.00 · £8.91</span></div>'
 '<div><span class="tlab">Utility · IBM Plex Mono · 13 / 11</span><span style="font:400 13px \'IBM Plex Mono\'">Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC</span>'
 '<span style="font:600 11px \'IBM Plex Mono\';letter-spacing:.09em;text-transform:uppercase;color:var(--p-muted)">Your key · Settled in 0.6 s</span></div>'
 '</div></div>'
 '</div>')

app_css = open(os.path.join(HERE, 'app.css')).read() + open(os.path.join(HERE, 'extra.css')).read()
page_css = open(os.path.join(HERE, 'page.css')).read()

total = len(SCREENS)
doc = f'''<title>Plans Screens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Roboto:wght@400;500&display=swap">
<style>
{page_css}
{app_css}
</style>
<div class="page">
<header class="intro wrap">
  <div class="brandrow">{logo(26)}<span class="tag">App screens · design gate · v1 · 6 Oct 2026</span></div>
  <h1>Every screen in the Plans Android app, ready for a yes or no.</h1>
  <p class="lede">Plans is a group money pot for trips, festivals and plans. Friends in different countries join with a fingerprint, fund one pot in dollars, spend under rules the group sets, watch every spend live, and settle up in one tap. This page shows all <b>{total}</b> screens and states, grouped into {len(FLOWS)} flows.</p>
  <div class="how">
    <div><b>Review by number.</b> Each numbered card is one review item. Reply with something like “approve all except 22b, 38”. Letters (14b, 22a–c, 27b, 45b) are states added beyond the brief.</div>
    <div><b>Real size, both themes.</b> Each screen is a 390 px wide phone, shown light and dark side by side. Tall screens are drawn at the height their content needs; the app scrolls.</div>
    <div><b>Captions.</b> What the screen is for, how you get in and out, and the states not drawn.</div>
    <div><b>Words.</b> Users see “Your Plans account”, “dollars”, “Confirm with fingerprint”, “Done” and a small “Proof” link on receipts. They never see technical money words. “Digital dollars (AUSD)” appears only on 09 and in Send (43, 45).</div>
  </div>
</header>
<nav class="idx" aria-label="Flows"><div class="idxin">{idx}</div><button class="themetog" type="button" aria-label="Switch page theme">◐</button></nav>
<main class="wrap">
<section class="tokens"><h2 class="th">Design tokens</h2><p class="small">“Festival wristband”: marigold on deep pine. Radius 14 on cards, 999 on chips and buttons, 16 px gutters, 48 px touch targets. Shadows only on things that float (toasts, sheets).</p>{tokens}</section>
{"".join(sections)}
<footer class="foot"><p>Plans · app screens v1 · {total} screens · light and dark. Static mock-ups; nothing here is live.</p></footer>
</main>
</div>
<script>
(function(){{
  var links=[].slice.call(document.querySelectorAll('.idx a'));
  var map={{}};links.forEach(function(a){{map[a.dataset.f]=a;}});
  if('IntersectionObserver' in window){{
    var io=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{links.forEach(function(a){{a.classList.remove('on')}});var a=map[e.target.id.slice(5)];if(a){{a.classList.add('on');try{{a.scrollIntoView({{block:'nearest',inline:'nearest'}})}}catch(_){{}}}}}}}})}},{{rootMargin:'-45% 0px -50% 0px'}});
    document.querySelectorAll('.flow').forEach(function(s){{io.observe(s)}});
  }}
  var r=document.documentElement,b=document.querySelector(".themetog");
  b.addEventListener('click',function(){{var dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';}});
}})();
</script>
'''
open(OUT, 'w').write(doc)
print('screens', total, 'bytes', len(doc.encode()))
