import random

SCREENS = []

def add(flow, n, title, purpose, entry, exit_, states, body, tab=None, h=844, over='', scr=''):
    SCREENS.append(dict(flow=flow, n=n, title=title, purpose=purpose, entry=entry, exit=exit_,
                        states=states, body=body, tab=tab, h=h, over=over, scr=scr))

# ---------------------------------------------------------------- icons
_I = {
 'back': '<path d="m15 18-6-6 6-6"/>',
 'chev': '<path d="m9 18 6-6-6-6"/>',
 'down': '<path d="m6 9 6 6 6-6"/>',
 'x': '<path d="M18 6 6 18M6 6l12 12"/>',
 'plus': '<path d="M12 5v14M5 12h14"/>',
 'check': '<path d="M20 6 9 17l-5-5"/>',
 'out': '<path d="M7 17 17 7M8 7h9v9"/>',
 'in': '<path d="M17 7 7 17M16 17H7V8"/>',
 'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
 'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 'ticket': '<path d="M2 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
 'send': '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
 'scan': '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
 'qr': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h4v-3"/>',
 'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
 'share': '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
 'copy': '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
 'pause': '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
 'play': '<path d="M7 4v16l13-8z"/>',
 'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 'shieldok': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
 'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
 'alert': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
 'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
 'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
 'wifioff': '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01"/>',
 'refresh': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
 'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
 'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 'receipt': '<path d="M5 2v20l2-1.5L9 22l2-1.5L13 22l2-1.5L17 22l2-1.5V2l-2 1.5L15 2l-2 1.5L11 2 9 3.5 7 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
 'edit': '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
 'help': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
 'logout': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
 'store': '<path d="M3 9 4.5 4h15L21 9M3 9h18v11H3zM3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5"/>',
 'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
 'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
 'fp': '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
 'globe': '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
 'flag': '<path d="M4 22V4s1-1 4-1 5 2 8 2 4-1 4-1v11s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
 'scale': '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
 'key': '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
 'zap': '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
 'cal': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 'more': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
 'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
 'phone': '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
 'note': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
 'swap': '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4"/>',
 'torch': '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12zM6 6h12M12 12v.01"/>',
 'gift': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
 'vote': '<path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5z"/><path d="M22 19H2"/>',
 'sparkle': '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
 'cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
 'card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 'eye': '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
}

def ic(name, s=24, sw=1.8, cls='i'):
    return (f'<svg class="{cls}" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{_I[name]}</svg>')

# ---------------------------------------------------------------- people & plans
P = {
 'maya': dict(n='Maya', i='M', c='#D9634B', f='🇬🇧', city='London', cur='£'),
 'sam':  dict(n='Sam',  i='S', c='#3C78B8', f='🇺🇸', city='New York', cur='$'),
 'asha': dict(n='Asha', i='A', c='#8C5CC4', f='🇮🇳', city='Bengaluru', cur='₹'),
 'ben':  dict(n='Ben',  i='B', c='#2B8A5F', f='🇬🇧', city='Manchester', cur='£'),
 'kai':  dict(n='Kai',  i='K', c='#B7792A', f='🇩🇪', city='Berlin', cur='€'),
 'ines': dict(n='Inês', i='I', c='#5E6B73', f='🇵🇹', city='Lisbon', cur='€'),
}
W = dict(lagoon='#2FA6B8', orchid='#D9539B', marigold='#F5B83D', coral='#F07A5A', lime='#8DBF3F', iris='#8C93F0')

def av(k, s=40, flag=True, ring=False):
    p = P[k]
    fl = f'<b>{p["f"]}</b>' if flag else ''
    r = ' ring' if ring else ''
    return f'<span class="av{r}" style="--c:{p["c"]};--s:{s}px">{p["i"]}{fl}</span>'

def avs(keys, s=28):
    return '<span class="avs">' + ''.join(av(k, s, flag=False) for k in keys) + '</span>'

def m2(a, b, cls=''):
    return f'<span class="{cls}">{a}</span> <span class="m2">· {b}</span>'

def demo():
    return '<span class="demo">Demo</span>'

def chip(t, cls=''):
    return f'<span class="chip {cls}">{t}</span>'

def btn(label, kind='pri', icon=None, cls='', style=''):
    i = ic(icon, 22, 2) if icon else ''
    st = f' style="{style}"' if style else ''
    return f'<span class="btn {kind} {cls}"{st}>{i}{label}</span>'

def ab(title='', back=True, right='', icon='back', sub=''):
    b = f'<span class="ib">{ic(icon)}</span>' if back else '<span style="width:8px"></span>'
    s = f'<small>{sub}</small>' if sub else ''
    return f'<div class="ab">{b}<h1>{title}{s}</h1>{right}</div>'

def ib(name):
    return f'<span class="ib">{ic(name)}</span>'

def wb(color, text, cls=''):
    return f'<div class="wb {cls}" style="--w:{color}"><span>{text}</span><i></i></div>'

def bn(kind, icon, title, text='', extra=''):
    t = f'<span>{text}</span>' if text else ''
    return f'<div class="bn k-{kind}"><span class="bi">{ic(icon, 22, 2)}</span><div><b>{title}</b>{t}{extra}</div></div>'

def fp(label='Your key'):
    return f'<span class="fp"><small>{label}</small><span>🦊🌵🎈</span></span>'

def proof():
    return f'<span class="proof">Proof {ic("out", 14, 2.2)}</span>'

def bar(pct, color='var(--ink)', over=False):
    c = 'var(--neg)' if over else color
    return f'<div class="bar"><i style="width:{pct}%;background:{c}"></i></div>'

def field(label, value, cls='', right='', hint=''):
    r = f'<span class="fr">{right}</span>' if right else ''
    h = f'<div class="t13 mut mt4">{hint}</div>' if hint else ''
    return f'<div><div class="fld {cls}"><div><label>{label}</label><div class="fv">{value}</div></div>{r}</div>{h}</div>'

def toggle(on=True):
    return f'<span class="sw{" on" if on else ""}"><i></i></span>'

def li(left, title, sub='', right='', rsub='', cls=''):
    s = f'<div class="t13 mut">{sub}</div>' if sub else ''
    rs = f'<div class="t13 mut">{rsub}</div>' if rsub else ''
    rr = f'<div class="lr">{right}{rs}</div>' if (right or rsub) else ''
    return f'<div class="li {cls}">{left}<div class="lm"><div class="lt">{title}</div>{s}</div>{rr}</div>'

def tile(icon, cls=''):
    return f'<span class="tl {cls}">{ic(icon, 22)}</span>'

def emo(e, color, s=48):
    return f'<span class="emo" style="--w:{color};--s:{s}px">{e}</span>'

def stub(head, lines, foot='', cls=''):
    ls = ''.join((f'<div class="ln"><span>{a}</span><span>{b}</span></div>' if a else f'<div class="ln full"><span>{b}</span></div>') for a, b in lines)
    f = f'<div class="ln sf">{foot}</div>' if foot else ''
    return (f'<div class="stub {cls}"><div class="st">{head}</div><div class="perf"></div>'
            f'<div class="sbm">{ls}{f}</div><div class="edge"></div></div>')

def kp():
    keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', ic('back', 26, 2)]
    return '<div class="kp">' + ''.join(f'<b>{k}</b>' for k in keys) + '</div>'

def logo(size=22):
    return f'<span class="logo" style="font-size:{size}px"><span class="lb"></span>plans</span>'

def qr(seed, px=200, n=29, center=''):
    rnd = random.Random(seed)
    grid = [[rnd.random() < 0.48 for _ in range(n)] for _ in range(n)]
    def finder(ox, oy):
        for y in range(-1, 8):
            for x in range(-1, 8):
                xx, yy = ox + x, oy + y
                if 0 <= xx < n and 0 <= yy < n:
                    edge = x in (0, 6) or y in (0, 6)
                    core = 2 <= x <= 4 and 2 <= y <= 4
                    grid[yy][xx] = (0 <= x <= 6 and 0 <= y <= 6) and (edge or core)
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7)
    # small alignment pattern
    ax = ay = n - 9
    for y in range(-2, 3):
        for x in range(-2, 3):
            grid[ay + y][ax + x] = max(abs(x), abs(y)) != 1
    # clear centre for logo
    c0, c1 = n // 2 - 4, n // 2 + 4
    if center:
        for y in range(c0, c1 + 1):
            for x in range(c0, c1 + 1):
                grid[y][x] = False
    d = []
    for y in range(n):
        x = 0
        while x < n:
            if grid[y][x]:
                s = x
                while x < n and grid[y][x]:
                    x += 1
                d.append(f'M{s} {y}h{x - s}v1h-{x - s}z')
            else:
                x += 1
    cen = ''
    if center:
        cen = f'<div class="qrc">{center}</div>'
    return (f'<div class="qr" style="width:{px}px;height:{px}px"><svg viewBox="-1 -1 {n + 2} {n + 2}" width="{px}" height="{px}" '
            f'shape-rendering="crispEdges"><rect x="-1" y="-1" width="{n + 2}" height="{n + 2}" fill="#fff"/>'
            f'<path d="{"".join(d)}" fill="#10231B"/></svg>{cen}</div>')

def tabs(active):
    items = [('plans', 'ticket', 'Plans'), ('send', 'send', 'Send'), ('act', 'bell', 'Activity'), ('you', 'user', 'You')]
    out = []
    for k, i, l in items:
        on = ' class="on"' if k == active else ''
        dot = '<em></em>' if k == 'act' and active != 'act' else ''
        out.append(f'<a{on}><i>{ic(i, 22, 2)}{dot}</i>{l}</a>')
    return '<nav class="tabs">' + ''.join(out) + '</nav>'

SB = ('<div class="sb"><span>14:05</span><span class="sbi">'
      '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 13.5 1 6.2a10.5 10.5 0 0 1 14 0z" fill="currentColor"/></svg>'
      '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M15 2v13H2z" fill="currentColor"/></svg>'
      '<svg width="22" height="16" viewBox="0 0 22 16"><rect x="1" y="3" width="18" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/>'
      '<rect x="3" y="5" width="12" height="6" rx="1.5" fill="currentColor"/><rect x="20" y="6" width="1.6" height="4" rx=".8" fill="currentColor"/></svg>'
      '</span></div>')

def phone(s, theme):
    tab = tabs(s['tab']) if s['tab'] else ''
    gn = '<div class="gn s"><i></i></div>' if s['tab'] else '<div class="gn"><i></i></div>'
    return (f'<div class="phone {theme}"><div class="scr {s["scr"]}" style="--h:{s["h"]}px">{SB}'
            f'<div class="body">{s["body"]}</div>{tab}{gn}{s["over"]}</div></div>')

# ---------------------------------------------------------------- Android system passkey sheet
def sys_sheet(mode='use', title=None):
    if title is None:
        title = 'Use passkey for plans.0xo.in?' if mode != 'create' else 'Create passkey for plans.0xo.in?'
    if mode == 'pick':
        accts = (
            '<div class="sysacc on"><span class="sysav">M</span><div><b>Maya</b><small>Passkey · Google Password Manager</small></div>'
            f'<span class="sysrad"></span></div>'
            '<div class="sysacc"><span class="sysav" style="background:#7a8a99">M</span><div><b>maya.work</b><small>Passkey · Google Password Manager</small></div>'
            '<span class="sysrad off"></span></div>'
            '<div class="sysmore">Use a passkey from another device</div>')
        bottom = '<div class="sysbtns"><span class="systxt">Cancel</span><span class="syspri">Continue</span></div>'
        mid = accts
    else:
        acct = ('<div class="sysacc single"><span class="sysav">M</span><div><b>Maya</b>'
                f'<small>{"Saved to Google Password Manager" if mode == "create" else "Passkey · Google Password Manager"}</small></div></div>')
        mid = (acct + '<div class="sysbio"><div class="sysst">Use your screen lock</div>'
               f'<span class="sysfp">{ic("fp", 40, 1.6)}</span><div class="syshint">Touch the fingerprint sensor</div></div>')
        bottom = '<div class="sysbtns"><span class="systxt">Cancel</span><span class="systxt">Use PIN</span></div>'
    return (f'<div class="scrim"></div><div class="sys"><div class="syskey">{ic("key", 22, 2)}</div>'
            f'<div class="systitle">{title}</div>{mid}{bottom}</div>')

def app_sheet(inner):
    return f'<div class="scrim"></div><div class="sheet"><div class="hd"></div>{inner}</div>'
