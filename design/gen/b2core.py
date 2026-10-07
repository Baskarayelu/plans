"""Build 2 shared helpers: laptop browser frames, desktop app shell, phone-browser frames.
Imports the approved helpers from base.py so every token, font and component stays identical."""
import base
from base import *

base._I.update({
 'msg': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
 'bank': '<path d="M3 21h18M5 21V10M19 21V10M9.7 21V10M14.3 21V10M2 10l10-7 10 7z"/>',
 'tune': '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 'star': '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
 'menu': '<path d="M3 6h18M3 12h18M3 18h18"/>',
 'sidebar': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
 'bt': '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
 'monitor': '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
 'trend': '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
 'home': '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
 'tabs': '<rect x="4" y="4" width="16" height="16" rx="3"/>',
 'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
 'person-key': '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 11-5.7"/><circle cx="18" cy="15" r="2.5"/><path d="M18 17.5V22M18 20h2"/>',
 'reload': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
 'fwd': '<path d="m9 18 6-6-6-6"/>',
 'cash': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
 'flash': '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
 'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
})

ITEMS = []
SECTIONS = []


def section(k, name, desc, g2=False, note=''):
    SECTIONS.append(dict(k=k, name=name, desc=desc, g2=g2, note=note))


def item(sec, n, title, purpose, entry, exit_, states, kind, frame, g2=False, labels=('Light', 'Dark')):
    """kind: 'phone' (pair side by side), 'lap' (1440x900, stacked, scaled to fit), ('w', width, max) for cards."""
    ITEMS.append(dict(sec=sec, n=n, title=title, purpose=purpose, entry=entry, exit=exit_, states=states,
                      kind=kind, frame=frame, g2=g2, labels=labels))


# ------------------------------------------------------------------ phone helpers
def aphone(theme, body, h=844, tab=None, over='', scr=''):
    return phone(dict(body=body, tab=tab, h=h, over=over, scr=scr), theme)


IOS_SB = ('<div class="isb"><span>14:05</span><span class="sbi">'
          '<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/>'
          '<rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>'
          '<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.5 6.9a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0zM1 4.4a10 10 0 0 1 14 0l-1.4 1.4a8 8 0 0 0-11.2 0z" fill="currentColor"/></svg>'
          '<svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/><path d="M24 4v4" stroke="currentColor" stroke-width="1.5" opacity=".45"/></svg>'
          '</span></div>')


def chrome_mbar(url):
    return (f'<div class="cmb"><span class="cmi">{ic("home", 20, 2)}</span><div class="cmo">{ic("tune", 16, 2)}<span>{url}</span></div>'
            f'<span class="cmt">2</span><span class="cmi">{ic("more", 20, 2.4)}</span></div>')


def safari_bar(url):
    return (f'<div class="sfm"><div class="sfp"><span class="b" style="font-size:14px">aA</span><span class="sfu">{ic("lock", 12, 2.4)}{url}</span>{ic("reload", 16, 2)}</div>'
            f'<div class="sft">{ic("back", 22, 2)}{ic("fwd", 22, 2)}{ic("share", 22, 2)}{ic("book", 22, 2)}{ic("tabs", 22, 2)}</div></div>')


def mphone(theme, inner, h=844, kind='chrome', url='plans.0xo.in', over='', tab=None):
    """The web app or site inside a phone browser. kind: chrome (Android) or safari (iPhone)."""
    if kind == 'safari':
        top, bot = IOS_SB, safari_bar(url) + '<div class="ihome"><i></i></div>'
    else:
        top, bot = SB + chrome_mbar(url), '<div class="gn"><i></i></div>'
    tb = tabs(tab) if tab else ''
    return (f'<div class="phone {theme}"><div class="scr" style="--h:{h}px">{top}'
            f'<div class="body">{inner}</div>{tb}{bot}{over}</div></div>')


# ------------------------------------------------------------------ laptop browser frames
def _url(u):
    host, _, path = u.partition('/')
    p = f'/{path}' if path else ''
    return f'<b>{host}</b>{p}'


def lap(theme, url, body, over='', tab='Plans', browser='chrome'):
    if browser == 'safari':
        top = (f'<div class="sfb"><span class="tl3"><i></i><i></i><i></i></span><span class="bic">{ic("sidebar", 18, 1.8)}</span>'
               f'<span class="bic">{ic("back", 18, 2)}</span><span class="bic">{ic("fwd", 18, 2)}</span>'
               f'<div class="sfaddr">{ic("lock", 12, 2.4)}<span>{url.split("/")[0]}</span></div>'
               f'<span class="bic">{ic("share", 18, 1.8)}</span><span class="bic">{ic("plus", 18, 1.8)}</span><span class="bic">{ic("grid", 17, 1.8)}</span></div>')
    else:
        top = (f'<div class="brs"><span class="tl3"><i></i><i></i><i></i></span>'
               f'<span class="btab"><span class="fav"></span>{tab}<span class="x">{ic("x", 13, 2)}</span></span>'
               f'<span class="bplus">{ic("plus", 16, 2)}</span></div>'
               f'<div class="btb"><span class="bic">{ic("back", 18, 2)}</span><span class="bic">{ic("fwd", 18, 2)}</span>'
               f'<span class="bic">{ic("reload", 16, 2)}</span><div class="omni">{ic("tune", 15, 2)}<span>{_url(url)}</span></div>'
               f'<span class="bic">{ic("star", 16, 1.8)}</span><span class="bprof">M</span><span class="bic">{ic("more", 18, 2.4)}</span></div>')
    return f'<div class="lap fx {theme}">{top}<div class="vp">{body}</div>{over}</div>'


# ------------------------------------------------------------------ desktop app shell
RAIL_PLANS = [
    ('lis', '🌊', W['lagoon'], 'Lisbon, 12–16 Oct', '<span class="pos">+£18.00</span>'),
    ('gla', '🎪', W['orchid'], 'Glastonbury crew', '<span class="neg">−£8.91</span>'),
]


def rail(active='plans', plan=None, dot=True):
    nav = [('plans', 'ticket', 'Plans'), ('send', 'send', 'Send'), ('act', 'bell', 'Activity'), ('you', 'user', 'You')]
    out = [f'<div class="lg">{logo(22)}</div>']
    for k, i, l in nav:
        on = ' on' if k == active else ''
        em = '<em></em>' if (k == 'act' and dot and active != 'act') else ''
        cnt = '<span class="cnt">2</span>' if (k == 'act' and dot) else ''
        out.append(f'<div class="nv{on}">{ic(i, 20, 2)}{em}{l}{cnt}</div>')
    out.append('<div class="rh">Your plans</div>')
    for k, e, c, n, pos in RAIL_PLANS:
        on = ' on' if k == plan else ''
        out.append(f'<div class="rp{on}" style="--w:{c}"><span class="emo" style="--w:{c};--s:30px">{e}</span><span class="lm">{n}</span><span class="t11 b">{pos}</span></div>')
    out.append(f'<div class="rp mut" style="font-weight:600">{ic("plus", 18, 2.2)}<span class="lm">New plan</span></div>')
    out.append(f'<div class="rp mut" style="font-weight:600">{ic("link", 18, 2)}<span class="lm">Join with a link</span></div>')
    out.append('<div class="sp"></div>')
    out.append('<div class="rbal"><div class="ov">Your Plans account</div><div class="row sbw mt4"><span class="d22">$5.00</span><span class="t13 m2">£3.71</span></div></div>')
    out.append(f'<div class="ruser">{av("maya", 34)}<div class="lm"><div class="lt">Maya</div><div class="t11 mut">London · £ GBP</div></div><span class="fps">🦊🌵🎈</span></div>')
    return '<aside class="rail">' + ''.join(out) + '</aside>'


def shell(active, main, side='', plan=None, dot=True, main_style=''):
    sd = f'<aside class="side">{side}</aside>' if side else ''
    ms = f' style="{main_style}"' if main_style else ''
    return rail(active, plan, dot) + f'<main class="main"{ms}>{main}</main>' + sd


def crumb(*parts):
    xs = []
    for i, p in enumerate(parts):
        if i:
            xs.append(f'<span class="mut">{ic("chev", 14, 2)}</span>')
        xs.append(f'<span class="{"b" if i == len(parts) - 1 else "mut"}">{p}</span>')
    return '<div class="crumb">' + ''.join(xs) + '</div>'


def g2tag():
    return '<span class="g2t">Group 2</span>'


# ------------------------------------------------------------------ system dialogs (desktop browsers)
def chrome_create(over_qr=False):
    if over_qr:
        inner = (f'<div class="cdh">{ic("phone", 22, 1.8)}</div>'
                 '<div class="cdt">Use a phone or tablet to create a passkey</div>'
                 '<p class="cdp">Scan this QR code with the camera on the device where you want to save a passkey for plans.0xo.in.</p>'
                 f'<div class="c" style="margin:6px 0 14px"><div style="display:inline-block;padding:8px;background:#fff;border-radius:12px">{qr("cqr", 168)}</div></div>'
                 f'<p class="cdp row" style="gap:8px;align-items:flex-start">{ic("bt", 16, 2)}<span>Both devices need Bluetooth on and must be near each other. Nothing is shared with this computer except the passkey request.</span></p>'
                 '<div class="cdb"><span class="cbt o">Back</span><span class="sp"></span><span class="cbt o">Cancel</span></div>')
    else:
        inner = (f'<div class="cdh">{ic("key", 22, 1.8)}</div>'
                 '<div class="cdt">Create a passkey for plans.0xo.in</div>'
                 '<div class="cda"><span class="sysav">M</span><div><b>Maya</b><small>Google Password Manager</small></div></div>'
                 '<p class="cdp">A passkey will be saved for Maya in Google Password Manager. You can use it on your other devices.</p>'
                 '<div class="cdb"><span class="cbt t">Use a phone or tablet</span><span class="sp"></span><span class="cbt o">Cancel</span><span class="cbt p">Create</span></div>')
    return f'<div class="cdlg">{inner}</div>'


def chrome_pick():
    return ('<div class="cdlg">'
            f'<div class="cdh">{ic("key", 22, 1.8)}</div>'
            '<div class="cdt">Choose a passkey for plans.0xo.in</div>'
            '<div class="cda on"><span class="sysav">M</span><div><b>Maya</b><small>Google Password Manager</small></div><span class="sysrad"></span></div>'
            '<div class="cda"><span class="sysav" style="background:#7a8a99">M</span><div><b>maya.work</b><small>Google Password Manager</small></div><span class="sysrad off"></span></div>'
            f'<div class="cdl">{ic("phone", 18, 1.8)}Use a phone or tablet</div>'
            '<div class="cdb"><span class="sp"></span><span class="cbt o">Cancel</span><span class="cbt p">Continue</span></div></div>')


def safari_create():
    return ('<div class="sfd">'
            f'<div class="sfk">{ic("person-key", 30, 1.7)}</div>'
            '<div class="sft2">Do you want to save a passkey for “plans.0xo.in”?</div>'
            '<p>Passkeys are saved in your iCloud Keychain and are available on all your devices.</p>'
            '<div class="sfacct"><span class="sysav">M</span><b>Maya</b></div>'
            '<div class="sfbtns"><span class="sfo">Other Options…</span><span class="sp"></span><span class="sfo">Cancel</span><span class="sfc">Continue</span></div></div>')


LIS = W['lagoon']


def bigband(color, text, top, left, rot, w=2600, h=120, fs=30):
    return (f'<div class="band" style="--w:{color};top:{top}px;left:{left}px;width:{w}px;height:{h}px;font-size:{fs}px;border-radius:24px;gap:60px;padding:0 40px;transform:rotate({rot}deg)">'
            f'<span>{text}</span><i style="width:48px;height:48px;box-shadow:inset 0 0 0 10px rgba(16,35,27,.25)"></i><span>{text}</span><i style="width:48px;height:48px;box-shadow:inset 0 0 0 10px rgba(16,35,27,.25)"></i><span>{text}</span></div>')


FLAGS = '<div class="flagrow"><span><em>🇬🇧</em>2</span><span><em>🇺🇸</em>1</span><span><em>🇮🇳</em>1</span></div>'


def share_portrait(theme, name=False):
    head = 'Lisbon, 12–16 Oct' if name else '4 friends · 3 countries · settled in one tap'
    sub = '<div style="font:600 40px Figtree;margin-top:24px;color:var(--muted)">4 friends · 3 countries · settled in one tap</div>' if name else ''
    return (f'<div class="cardx fx {theme}" style="width:1080px;height:1350px;padding:84px 84px 72px;display:flex;flex-direction:column">'
            + bigband(LIS, 'SETTLED · SAT 17 OCT 2026', 770, -400, -6) + bigband(W['marigold'], 'LONDON · NEW YORK · BENGALURU · MANCHESTER', 900, -700, 4)
            + f'<div class="row sbw" style="position:relative">{logo(56)}<span class="mono" style="font-size:26px;letter-spacing:.1em;color:var(--muted)">SETTLED · 17 OCT</span></div>'
            + f'<h1 style="font:800 118px/1 \'Bricolage Grotesque\',sans-serif;letter-spacing:-.045em;margin:84px 0 0;position:relative">{head}</h1>{sub}'
            + f'<div style="margin-top:56px;position:relative">{FLAGS}</div>'
            + '<div style="flex:1"></div>'
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;position:relative">'
            + ''.join(f'<div style="background:var(--surface);border:2px solid var(--line);border-radius:28px;padding:26px 28px"><div style="font:800 56px/1 \'Bricolage Grotesque\';letter-spacing:-.03em">{v}</div>'
                      f'<div style="font:500 26px Figtree;color:var(--muted);margin-top:10px">{l}</div></div>' for v, l in [('$800', 'put in together'), ('$112.40', 'paid back out'), ('0.6 s', 'to settle up')])
            + '</div>'
            + '<div class="row sbw" style="margin-top:36px;position:relative;font:500 26px \'IBM Plex Mono\',monospace;color:var(--muted)"><span>plans.0xo.in/s/7kq2</span><span>Proof on Monad</span></div></div>')


def share_land(theme):
    return (f'<div class="cardx fx {theme}" style="width:1200px;height:630px;padding:52px 64px 120px;display:flex;gap:56px">'
            + bigband(LIS, 'SETTLED · SAT 17 OCT 2026 · 4 FRIENDS · 3 COUNTRIES', 548, -300, -2, h=84, fs=22)
            + '<div style="flex:1;display:flex;flex-direction:column;position:relative">'
            + f'{logo(40)}<h1 style="font:800 76px/1.02 \'Bricolage Grotesque\',sans-serif;letter-spacing:-.04em;margin:40px 0 0">4 friends · 3 countries · settled in one tap</h1>'
            + '<div style="flex:1"></div><div class="mono" style="font-size:20px;color:var(--muted)">plans.0xo.in/s/7kq2 · Proof on Monad</div></div>'
            + '<div style="width:330px;display:flex;flex-direction:column;gap:16px;position:relative;padding-top:8px">'
            + '<div class="flagrow" style="flex-wrap:wrap;gap:12px"><span style="font-size:28px"><em style="font-size:40px">🇬🇧</em>2</span><span style="font-size:28px"><em style="font-size:40px">🇺🇸</em>1</span><span style="font-size:28px"><em style="font-size:40px">🇮🇳</em>1</span></div>'
            + ''.join(f'<div style="background:var(--surface);border:2px solid var(--line);border-radius:22px;padding:18px 22px"><div style="font:800 44px/1 \'Bricolage Grotesque\';letter-spacing:-.03em">{v}</div>'
                      f'<div style="font:500 20px Figtree;color:var(--muted);margin-top:6px">{l}</div></div>' for v, l in [('$800', 'put in together'), ('0.6 s', 'to settle up')])
            + '</div></div>')



CSS = r'''
/* ===== Build 2 additions. Same tokens as app.css; nothing here redefines a colour. ===== */
.g2t{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font:600 10.5px/1 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;
  background:repeating-linear-gradient(-45deg,#F5B83D 0 8px,#F7C862 8px 16px);color:#10231B;vertical-align:3px;margin-left:8px}
.badge-g2{display:inline-flex;align-items:center;gap:6px;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;
  background:repeating-linear-gradient(-45deg,#F5B83D 0 8px,#F7C862 8px 16px);color:#10231B}
.lapw{width:100%;overflow:hidden;border-radius:12px;padding:1px}
.lapw>*{zoom:.5}
@media (max-width:700px){.lapw>*{zoom:.24}}
.lapw.full{overflow-x:auto}
.lstack{display:flex;flex-direction:column;gap:28px}
.lstack figure{margin:0;min-width:0}
.lstack figcaption,.cardrow figcaption{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--p-muted);margin:0 0 8px 4px;display:flex;align-items:center;gap:10px}
.zbtn{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-ink);border-radius:999px;padding:3px 9px;cursor:pointer}
.cardrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:24px}
.cardrow figure{margin:0;min-width:0}
.shot.wide{grid-column:1/-1}
.shot .g2t{vertical-align:4px}
.note{background:var(--p-surface);border:1px solid var(--p-line);border-radius:14px;padding:14px 16px;font-size:14.5px;line-height:1.55;max-width:110ch}
.note b{font-weight:700}
.secnote{margin:-8px 0 24px;max-width:110ch}

/* laptop browser window: 1440 x 900, fixed palette like .phone */
.lap{width:1440px;height:900px;flex:none;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;position:relative;background:var(--bg);color:var(--ink);
  font:400 15px/1.45 Figtree,system-ui,sans-serif;text-align:left;-webkit-font-smoothing:antialiased;box-shadow:0 0 0 1px rgba(128,128,128,.4)}
.lap *,.cardx *{box-sizing:border-box}
.lap.light{--br-strip:#DEE3EA;--br-bar:#FFFFFF;--br-ink:#1F1F1F;--br-sub:#5F6368;--br-omni:#EEF1F4;--br-line:#D6DAE0}
.lap.dark{--br-strip:#18191B;--br-bar:#2B2C2F;--br-ink:#E8EAED;--br-sub:#9AA0A6;--br-omni:#1E1F22;--br-line:#3C4043}
.brs{height:40px;flex:none;background:var(--br-strip);display:flex;align-items:flex-end;gap:8px;padding:0 12px 0 16px}
.tl3{display:flex;gap:8px;align-self:center;margin-right:12px}.tl3 i{width:12px;height:12px;border-radius:50%;background:#FF5F57}.tl3 i+i{background:#FEBC2E}.tl3 i+i+i{background:#28C840}
.btab{height:32px;width:240px;background:var(--br-bar);border-radius:10px 10px 0 0;display:flex;align-items:center;gap:8px;padding:0 10px 0 12px;font:400 12.5px Roboto,system-ui,sans-serif;color:var(--br-ink)}
.btab .x{margin-left:auto;color:var(--br-sub);display:grid}
.bplus{align-self:center;color:var(--br-sub);display:grid}
.fav{width:16px;height:16px;border-radius:4px;background:#10231B;display:grid;place-items:center;flex:none}
.fav::after{content:"";width:12px;height:5.5px;border-radius:1.4px;background:repeating-linear-gradient(90deg,#F5B83D 0 2.7px,#10231B 2.7px 3.6px)}
.btb{height:44px;flex:none;background:var(--br-bar);display:flex;align-items:center;gap:2px;padding:0 10px;border-bottom:1px solid var(--br-line);color:var(--br-sub)}
.bic{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;color:var(--br-sub);flex:none}
.omni{flex:1;height:34px;margin:0 8px;border-radius:999px;background:var(--br-omni);display:flex;align-items:center;gap:10px;padding:0 14px;font:400 14px Roboto,system-ui,sans-serif;color:var(--br-sub)}
.omni b{font-weight:400;color:var(--br-ink)}
.bprof{width:26px;height:26px;border-radius:50%;background:#D9634B;color:#fff;display:grid;place-items:center;font:500 12px Roboto,sans-serif;margin:0 6px;flex:none}
.sfb{height:52px;flex:none;background:var(--br-bar);display:flex;align-items:center;padding:0 14px;gap:4px;border-bottom:1px solid var(--br-line)}
.sfaddr{width:520px;margin:0 auto;height:34px;border-radius:10px;background:var(--br-omni);display:flex;align-items:center;justify-content:center;gap:6px;font:500 13.5px -apple-system,system-ui,sans-serif;color:var(--br-ink)}
.vp{flex:1;min-height:0;display:flex;position:relative;overflow:hidden;background:var(--bg)}
.lap .btn{height:48px;font-size:16px}
.lap .btn.sm{height:40px;font-size:14px;padding:0 16px}
.lap .btn.lg{height:56px;font-size:17px}

/* desktop app shell */
.rail{width:248px;flex:none;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px 14px;gap:2px}
.rail .lg{height:44px;display:flex;align-items:center;padding:0 12px;margin-bottom:10px}
.nv{height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;border-radius:999px;font:600 15px Figtree,sans-serif;color:var(--muted);position:relative;flex:none}
.nv.on{background:var(--accent);color:var(--on-accent)}
.nv em{position:absolute;left:28px;top:9px;width:8px;height:8px;border-radius:50%;background:var(--neg);box-shadow:0 0 0 2px var(--surface)}
.nv .cnt{margin-left:auto;min-width:22px;height:22px;border-radius:999px;background:var(--neg);color:#fff;display:grid;place-items:center;font:700 12px Figtree}
.nv.on .cnt{background:var(--on-accent);color:var(--accent)}
.rh{font:600 11px/1.3 'IBM Plex Mono',monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:20px 14px 6px}
.rp{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:12px;font-weight:600;font-size:14px;flex:none;position:relative}
.rp.on{background:var(--surface-2)}
.rp.on::before{content:"";position:absolute;left:-12px;top:8px;bottom:8px;width:4px;border-radius:0 4px 4px 0;background:var(--w)}
.rp .emo{border-radius:9px}
.rp .lm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rbal{background:var(--surface-2);border-radius:14px;padding:12px 14px;margin:8px 0}
.ruser{display:flex;align-items:center;gap:10px;padding:6px 4px 0}
.fps{font-size:13px;letter-spacing:2px;background:var(--surface-2);border-radius:999px;padding:2px 7px}
.main{flex:1;min-width:0;overflow:hidden;padding:24px 36px 24px;display:flex;flex-direction:column;position:relative}
.side{width:400px;flex:none;background:var(--surface);border-left:1px solid var(--line);padding:22px 24px;overflow:hidden;display:flex;flex-direction:column;position:relative}
.crumb{display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:10px}
.mh{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}
.mh .btns{flex:none}
.g2c{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.g3c{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.g4c{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.mc{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.mc.t{background:var(--surface-2);border-color:transparent}
.lap .wb{height:30px}
.tabsx{display:flex;gap:4px;background:var(--surface-2);border-radius:999px;padding:4px}
.tabsx span{flex:1;height:34px;border-radius:999px;display:grid;place-items:center;font-weight:600;font-size:13.5px;color:var(--muted);white-space:nowrap;padding:0 10px}
.tabsx span.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.kbd{font:600 11px 'IBM Plex Mono',monospace;border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;padding:1px 6px;color:var(--muted)}
.lap .li{min-height:58px}
.panel-x{position:absolute;inset:0;background:var(--surface);z-index:5;padding:22px 24px;display:flex;flex-direction:column;border-left:1px solid var(--line)}
.dimmed{opacity:.5}

/* Chrome desktop passkey dialogs (generic Google Material, drawn for reference) */
.cdlg{position:absolute;top:92px;left:50%;margin-left:-226px;width:452px;z-index:40;background:var(--br-bar);color:var(--br-ink);border-radius:16px;padding:24px 24px 18px;
  font:400 14px/1.45 Roboto,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.28),0 0 0 1px var(--br-line)}
.cdh{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--sys-tint);color:var(--sys-pri);margin-bottom:14px}
.cdt{font:400 22px/1.3 Roboto,sans-serif;margin-bottom:14px}
.cdp{color:var(--br-sub);margin:0 0 14px;font-size:14px}
.cda{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;margin-bottom:10px;border:1px solid var(--br-line)}
.cda.on{background:color-mix(in srgb,var(--sys-tint) 55%,var(--br-bar));border-color:transparent}
.cda>div{flex:1}.cda b{display:block;font-weight:500;font-size:15px}.cda small{color:var(--br-sub);font-size:13px}
.cdl{display:flex;align-items:center;gap:12px;color:var(--sys-pri);font-weight:500;padding:8px 14px}
.cdb{display:flex;align-items:center;gap:8px;margin-top:16px}
.cbt{height:38px;padding:0 18px;border-radius:999px;display:inline-flex;align-items:center;font-weight:500;font-size:14px}
.cbt.p{background:var(--sys-pri);color:var(--sys-on)}
.cbt.o{border:1px solid var(--br-line);color:var(--sys-pri)}
.cbt.t{color:var(--sys-pri);padding:0 4px}
/* Safari (macOS) passkey sheet */
.sfd{position:absolute;top:52px;left:50%;margin-left:-220px;width:440px;z-index:40;background:var(--br-bar);color:var(--br-ink);border-radius:0 0 14px 14px;padding:22px 22px 16px;
  font:400 13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.3),0 0 0 1px var(--br-line);text-align:center}
.sfk{width:56px;height:56px;margin:0 auto 10px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(#5AC8FA,#0A84FF);color:#fff}
.sft2{font-weight:700;font-size:14px;margin-bottom:6px}
.sfd p{margin:0 0 12px;color:var(--br-sub)}
.sfacct{display:flex;align-items:center;gap:10px;justify-content:center;padding:8px;border-radius:10px;background:var(--br-omni);margin-bottom:14px}
.sfacct .sysav{width:28px;height:28px;font-size:13px}
.sfbtns{display:flex;gap:8px;align-items:center}
.sfo{padding:5px 12px;border-radius:7px;background:var(--br-omni);font-weight:500}
.sfc{padding:5px 14px;border-radius:7px;background:#0A84FF;color:#fff;font-weight:500}

/* phone browsers */
.isb{height:50px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:8px 34px 0 40px;font:600 16px -apple-system,system-ui,sans-serif;position:relative;z-index:31}
.isb::after{content:"";position:absolute;left:50%;top:11px;width:122px;height:34px;margin-left:-61px;border-radius:20px;background:#000}
.cmb{height:56px;flex:none;display:flex;align-items:center;gap:6px;padding:0 6px 0 10px;background:var(--surface);border-bottom:1px solid var(--line);position:relative;z-index:30}
.phone.light .cmb{background:#FFFFFF}.phone.dark .cmb{background:#1F1F1F;border-color:#333}
.cmi{width:36px;height:36px;display:grid;place-items:center;color:var(--muted)}
.cmo{flex:1;height:40px;border-radius:999px;display:flex;align-items:center;gap:8px;padding:0 14px;font:400 15px Roboto,sans-serif}
.phone.light .cmo{background:#EEF0F3;color:#1F1F1F}.phone.dark .cmo{background:#303134;color:#E8EAED}
.cmt{width:22px;height:22px;border:2px solid currentColor;border-radius:5px;display:grid;place-items:center;font:700 11px Roboto;margin:0 6px;color:var(--muted)}
.sfm{flex:none;padding:8px 14px 2px;position:relative;z-index:30}
.phone.light .sfm{background:rgba(246,246,248,.96);color:#1C1C1E}.phone.dark .sfm{background:rgba(28,28,30,.96);color:#F2F2F7}
.sfp{height:46px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font:500 15px -apple-system,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.phone.light .sfp{background:#fff}.phone.dark .sfp{background:#2C2C2E}
.sfu{display:flex;align-items:center;gap:6px}
.sft{display:flex;justify-content:space-between;padding:10px 12px 0;color:#0A84FF}
.ihome{height:24px;flex:none;display:grid;place-items:center;position:relative;z-index:30}
.phone.light .ihome{background:rgba(246,246,248,.96)}.phone.dark .ihome{background:rgba(28,28,30,.96)}
.ihome i{width:134px;height:5px;border-radius:3px;background:var(--ink)}
.webtop{display:flex;align-items:center;justify-content:space-between;height:56px;flex:none}

/* share cards (rendered at real pixel size, scaled to fit) */
.cardx{position:relative;overflow:hidden;background:var(--bg);color:var(--ink);font:400 15px/1.45 Figtree,sans-serif;flex:none;border-radius:18px;box-shadow:0 0 0 1px rgba(128,128,128,.4)}
.cardx .band{width:2400px}
.flagrow{display:flex;gap:18px}
.flagrow span{display:inline-flex;align-items:center;gap:12px;background:var(--surface);border:2px solid var(--line);border-radius:999px;padding:10px 26px 10px 14px;font:700 34px Figtree}
.flagrow span em{font-style:normal;font-size:52px;line-height:1}

/* misc build-2 components */
.ticker{display:flex;gap:16px;align-items:center;font:500 12px 'IBM Plex Mono',monospace;color:var(--muted);white-space:nowrap;overflow:hidden}
.ticker b{color:var(--ink);font-weight:600}
.dbar{position:relative;height:30px;display:flex;align-items:center}
.dbar::before{content:"";position:absolute;left:50%;top:-4px;bottom:-4px;width:2px;background:var(--line)}
.dbar i{position:absolute;height:14px;border-radius:999px}
.wcg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.prot{border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.45}
.prot.y{background:color-mix(in srgb,var(--pos) 12%,var(--surface))}
.prot.n{background:color-mix(in srgb,var(--neg) 10%,var(--surface))}
.prot h5{margin:0 0 6px;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.prot.y h5{color:var(--pos)}.prot.n h5{color:var(--neg)}
.prot ul{margin:0;padding-left:18px}.prot li{margin:3px 0}
.tpl{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.tpl.on{border:2px solid var(--ink)}
.bub{padding:10px 12px;border-radius:16px;max-width:262px;font-size:15px;line-height:1.4}
.bub.o{background:var(--surface-2);border-bottom-left-radius:6px}
.bub.m{background:color-mix(in srgb,var(--accent) 22%,var(--surface));border-bottom-right-radius:6px}
.ocr{position:absolute;border:2px solid var(--accent);border-radius:6px;background:color-mix(in srgb,var(--accent) 18%,transparent)}
.spin{width:20px;height:20px;border-radius:50%;border:3px solid color-mix(in srgb,var(--on-accent) 25%,transparent);border-top-color:var(--on-accent);display:inline-block}
.wire{border:2px dashed var(--line);border-radius:14px;display:grid;place-items:center;color:var(--muted);font:600 12px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;text-align:center;padding:10px}
.slot{border:2px dashed var(--accent);border-radius:16px;padding:16px 18px;background:color-mix(in srgb,var(--accent) 8%,var(--surface));position:relative}
.slot .sl{position:absolute;top:-13px;left:16px;background:var(--accent);color:#10231B;font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:999px}
.ext{display:inline-flex;align-items:center;gap:6px;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--info);
  background:color-mix(in srgb,var(--info) 14%,var(--surface));padding:4px 10px;border-radius:999px}
'''
