"""Design addendum: link a browser that uses another password manager to an existing Plans account.
Items 165+. Same design system and page shell as build2.py. Run: python3 design/gen/build3.py"""
import re, sys, os, html
sys.path.insert(0, os.path.dirname(__file__))
from b2core import CSS, logo
import b3link
from b3link import ITEMS3 as ITEMS, SECTIONS3 as SECTIONS, CSS3

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'link-browser-screens.html')

# Copy rules: no technical money or security words on screen. "sign" only in "Sign out" / "sign in to".
BANNED = [r'\bwallets?\b', r'\baddress(es)?\b', r'\bgas\b', r'\btokens?\b', r'\bchains?\b', r'\btransactions?\b',
          r'\bblockchains?\b', r'\bcrypto\w*', r'\bseeds?\b', r'\bprivate keys?\b', r'\bencrypt\w*', r'\bsign\w*']
ALLOW = ['sign out', 'sign in to']


def visible_text(h):
    h = re.sub(r'<svg.*?</svg>', ' ', h, flags=re.S)
    h = re.sub(r'<style.*?</style>', ' ', h, flags=re.S)
    h = re.sub(r'<script.*?</script>', ' ', h, flags=re.S)
    h = re.sub(r'<[^>]+>', ' ', h)
    return html.unescape(h)


def banned_in(text):
    t = text.lower()
    for a in ALLOW:
        t = t.replace(a, '')
    return [w for w in BANNED if re.search(w, t)]


def frames(it, theme):
    k = it['kind']
    if k == 'both':
        return [it['frame'][0](theme), it['frame'][1](theme)]
    if k in ('phones', 'laps'):
        return it['frame'](theme)
    return [it['frame'](theme)]


problems = []
for it in ITEMS:
    for th in ('light', 'dark'):
        for f in frames(it, th):
            for w in banned_in(visible_text(f)):
                problems.append((it['n'], th, w))
if problems:
    print('BANNED WORDS ON SCREEN:', sorted(set(problems)))

nums = [it['n'] for it in ITEMS]
assert len(nums) == len(set(nums)), 'duplicate item numbers'
assert nums == [str(n) for n in range(165, 165 + len(nums))], nums

# Buttons: phones say "Confirm with fingerprint", laptops "Confirm with passkey".
for it in ITEMS:
    k = it['kind']
    for th in ('light',):
        fs = frames(it, th)
        kinds = (['lap', 'phone'] if k == 'both' else ['phone'] * len(fs) if k in ('phone', 'phones') else ['lap'] * len(fs))
        for kind, f in zip(kinds, fs):
            t = visible_text(f)
            if kind == 'lap':
                assert 'Confirm with fingerprint' not in t, it['n']
            else:
                assert 'Confirm with passkey' not in t, it['n']


def lapfig(f, label):
    return (f'<figure><figcaption>{label} · 1440 × 900<button class="zbtn" type="button">Actual size</button></figcaption>'
            f'<div class="lapw" data-w="1440">{f}</div></figure>')


def phfig(f, label):
    return f'<figure><figcaption>{label}</figcaption>{f}</figure>'


def shot(it):
    meta = ''.join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in (('Entry', it['entry']), ('Exit', it['exit']), ('States', it['states'])) if b)
    k = it['kind']
    if k == 'lap':
        body = f'<div class="lstack">{lapfig(it["frame"]("light"), "Laptop · Light")}{lapfig(it["frame"]("dark"), "Laptop · Dark")}</div>'
    elif k == 'phone':
        body = f'<div class="lpair">{phfig(it["frame"]("light"), "Android app · Light")}{phfig(it["frame"]("dark"), "Android app · Dark")}</div>'
    elif k == 'both':
        lf, pf = it['frame']
        body = (f'<div class="lstack">{lapfig(lf("light"), "Laptop · Chrome · Light")}{lapfig(lf("dark"), "Laptop · Chrome · Dark")}</div>'
                f'<div class="subh">Same screen in a phone browser · iPhone Safari · 390</div>'
                f'<div class="lpair">{phfig(pf("light"), "iPhone Safari · Light")}{phfig(pf("dark"), "iPhone Safari · Dark")}</div>')
    elif k == 'phones':
        L, D = it['frame']('light'), it['frame']('dark')
        body = (f'<div class="subh">Light</div><div class="lpair">' + ''.join(phfig(f, l) for f, l in zip(L, it['labels'])) + '</div>'
                f'<div class="subh">Dark</div><div class="lpair">' + ''.join(phfig(f, l) for f, l in zip(D, it['labels'])) + '</div>')
    else:  # laps
        L, D = it['frame']('light'), it['frame']('dark')
        parts = []
        for i, l in enumerate(it['labels']):
            parts.append(f'<div class="subh">{chr(97 + i)} · {l}</div><div class="lstack">{lapfig(L[i], "Light")}{lapfig(D[i], "Dark")}</div>')
        body = ''.join(parts)
    return (f'<article class="shot wide" id="s{it["n"]}"><header class="sh"><span class="num">{it["n"]}</span><h3>{it["title"]}</h3></header>'
            f'<p class="cap">{it["purpose"]}</p><dl class="meta">{meta}</dl>{body}</article>')


sections = []
for s in SECTIONS:
    its = [it for it in ITEMS if it['sec'] == s['k']]
    rng = f'{its[0]["n"]}–{its[-1]["n"]}' if len(its) > 1 else its[0]['n']
    note = f'<div class="note secnote">{s["note"]}</div>' if s.get('note') else ''
    sections.append(f'<section class="flow" id="flow-{s["k"]}"><div class="fh"><span class="fl">{s["k"]}</span><div><h2>{s["name"]}</h2>'
                    f'<p>{s["desc"]} <span class="fn">{"Items" if len(its) > 1 else "Item"} {rng}</span></p></div></div>{note}'
                    f'<div class="grid">{"".join(shot(it) for it in its)}</div></section>')

idx = ''.join(f'<a href="#flow-{s["k"]}" data-f="{s["k"]}"><b>{s["k"]}</b>{s["name"]}</a>' for s in SECTIONS)

app_css = open(os.path.join(HERE, 'app.css')).read() + open(os.path.join(HERE, 'extra.css')).read()
page_css = open(os.path.join(HERE, 'page.css')).read()


def dup_fixed(css):
    """Same as build2: rules for .phone.light / .phone.dark also apply to .fx.light / .fx.dark (laptop frames)."""
    def rep(m):
        sel = m.group(1)
        if '.phone.light' in sel or '.phone.dark' in sel:
            parts = [p.strip() for p in sel.split(',')]
            extra = [p.replace('.phone.light', '.fx.light').replace('.phone.dark', '.fx.dark') for p in parts if '.phone.' in p]
            return ','.join(parts + extra) + '{'
        return m.group(0)
    return re.sub(r'([^{}]+)\{', rep, css)


app_css = dup_fixed(app_css)
CHK = ' '.join(b3link.CHK)
total = len(ITEMS)

INTRO = f'''
  <div class="sec2">
    <div><b>Why this is needed.</b> Password managers don't share passkeys with each other. A Plans passkey saved in Google Password Manager on an Android phone isn't in iCloud Keychain on a Mac, so Safari there can't see it (and Chrome can't either, if it saves to a different place). Today, “Create account” in that browser would quietly make a second, empty account.</div>
    <div><b>What changes.</b> “Create account” on the web asks the browser for any Plans passkey first (165). If there isn't one, Plans asks (166): use your phone's passkey through the browser's own QR code (167), link this browser once (168–170), or start fresh. Plans never makes a second account without asking.</div>
    <div><b>Linking, in short.</b> This browser saves its own passkey. The computer shows a QR code and the same code in letters. The phone scans it, shows three pictures, and sends only after the person says they match and confirms with their fingerprint. The account, its plans and its key fingerprint stay the same.</div>
  </div>
  <div class="subh" style="margin-top:22px">Security, in plain words</div>
  <div class="sec2">
    <div><b>One code, once.</b> Each code works one time and runs out after 10 minutes. If the pictures don't match, nothing is sent; make a new code.</div>
    <div><b>Compare three pictures.</b> The computer and the phone each show three pictures (here {CHK}) made from that one link. If they don't match, the phone stops and nothing is sent. These are different from your key fingerprint, which never changes.</div>
    <div><b>Nothing readable on our server.</b> What the phone sends is scrambled so only the browser that made the code can open it. Plans' server passes it along and keeps nothing it could read.</div>
    <div><b>Each device has its own passkey.</b> Your phone's passkey never leaves your phone. A linked browser has its own, and you can remove it from You on either device without touching anything else. Your phone gets a notice whenever a browser is added.</div>
  </div>
  <div class="how">
    <div><b>Review by number.</b> Items run 165–{nums[-1]}, after Build 2's 101–164. Web screens are drawn at 1440 in Chrome on a Mac and again at 390 in iPhone Safari (the same problem on a phone). Phone-side screens are the Android app at 390. Every frame is light and dark.</div>
    <div><b>Same design system.</b> Colours, fonts, components, phone and laptop frames are imported unchanged from the Build 2 generator (design/gen/b3link.py, build3.py). Browser dialogs are drawn generically, like 103–106. Nothing moves: waiting is a line of text with the time the code runs out.</div>
    <div><b>Words.</b> Same rules as the app: passkey, key fingerprint, code, link, browser, phone, account, scrambled. Phones say “Confirm with fingerprint”; laptops say “Confirm with passkey”. There are no emails or passwords anywhere in Plans.</div>
  </div>'''

QUESTIONS = '''
<section class="flow" id="flow-Q"><div class="fh"><span class="fl">?</span><div><h2>Open questions for the lead</h2>
<p>Decisions this addendum assumes. Each is cheap to change now and expensive after build.</p></div></div>
<ol class="oq">
<li><b>Link pictures vs. key fingerprint.</b> The brief's example pictures were 🦊 🌵 🎈, which are Maya's key fingerprint everywhere else. To avoid two meanings for “three pictures”, the link uses its own set (🐙 🍋 🚲, different every link) and 170 shows the key fingerprint separately with “Same as on your phone”. Confirm.</li>
<li><b>Order of the three options on phones (166).</b> On an iPhone, option one needs a second device to scan the browser's QR. Should the phone-browser version put “Link this browser” first?</li>
<li><b>Name on the new passkey (168).</b> The browser's create dialog shows a name before Plans knows who this is. Drawn as “Plans”. Alternative: ask for the phone first and save the passkey after (one more step for the person, but the dialog can say “Maya”).</li>
<li><b>How often 176a happens.</b> Using a phone's passkey from a browser (167) only works for Plans if the browser passes back the part Plans uses to open receipts. If most target browsers don't, we could drop option one and keep two options. Needs a test on Chrome and Safari on Mac and Windows with an Android phone.</li>
<li><b>Removing a browser (178).</b> Drawn as “Confirm with passkey” on the laptop. Should removing a browser from the phone also need the fingerprint (yes in this draft), and should the phone be told when a browser removes itself?</li>
<li><b>Device label.</b> “Chrome on a Mac” comes from the computer and can't be trusted on its own; it's shown as a hint, with the pictures as the real check. OK to show, or leave it out?</li>
<li><b>“Add a browser” on the web.</b> An iPhone-only person has no Android app. Should the laptop You page (178, “+ Link another browser”) and the phone web app also offer “Add a browser”, so any device with the account can approve a new one?</li>
<li><b>Renaming 53's row.</b> “Phones with your passkey” becomes “Phones and browsers” on the phone (171); the laptop page keeps “Devices with your passkey” (118). Pick one wording for both.</li>
</ol></section>'''

doc = f'''<title>Plans Link a Browser</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Roboto:wght@400;500&display=swap">
<style>
{page_css}
{app_css}
{CSS}
{CSS3}
</style>
<div class="page">
<header class="intro wrap">
  <div class="brandrow">{logo(26)}<span class="tag">Design addendum · link a browser · v1 · 7 Oct 2026</span></div>
  <h1>Your account, in a browser that can't see your passkey.</h1>
  <p class="lede">Someone made their Plans account on an Android phone, then opens the web app on a Mac in Safari or a differently set-up Chrome. That browser can't see the phone's passkey. This addendum makes sure they're offered the account they already have, with a clear way to bring it across, and never get a second account by accident. <b>{total}</b> numbered items.</p>
  {INTRO}
</header>
<nav class="idx" aria-label="Sections"><div class="idxin">{idx}<a href="#flow-Q" data-f="Q"><b>?</b>Open questions</a></div><button class="themetog" type="button" aria-label="Switch page theme">◐</button></nav>
<main class="wrap">
{"".join(sections)}
{QUESTIONS}
<footer class="foot"><p>Plans · link a browser · addendum to Build 2 · {total} items · light and dark. Static mock-ups; nothing here is live. The code {b3link.CODE}, its pictures and the times are samples.</p></footer>
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

# Page-level copy check (captions and intro too), reported but not fatal: captions may name browser features.
page_hits = banned_in(visible_text(doc))
if page_hits:
    print('Note: page text (captions/intro) uses:', page_hits)

open(OUT, 'w').write(doc)
print('items', total, 'bytes', len(doc.encode()), '->', os.path.normpath(OUT))
