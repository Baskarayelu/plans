from b2core import *
from s1 import av_at
from s3 import edge

LIS = W['lagoon']
RATE = '<div class="mono t11 mut">Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC</div>'
AUSD = f'<span class="pill">Digital dollars (AUSD){ic("info", 14, 2)}</span>'


def lband(color, text, top, left, rot, w=1500, h=64, fs=15):
    return (f'<div class="band" style="--w:{color};top:{top}px;left:{left}px;width:{w}px;height:{h}px;font-size:{fs}px;transform:rotate({rot}deg)">'
            f'<span>{text}</span><i></i><span>{text}</span><i></i><span>{text}</span></div>')


# ================================================================== shared desktop pieces
def plan_head(btns=True):
    b = ('<div class="btns">' + btn('Add money', 'sec', 'plus', 'sm') + btn('Pay', 'pri', 'out', 'sm') + '</div>') if btns else ''
    return (f'<div class="row sbw">{crumb("Plans", "Lisbon, 12–16 Oct")}<span class="row t13 b" style="gap:6px;margin-bottom:10px">{ic("users", 16, 2)}Members &amp; rules</span></div>'
            + f'<div class="mh"><div class="row" style="gap:14px">{emo("🌊", LIS, 56)}<div><h1 class="d34" style="white-space:nowrap">Lisbon, 12–16 Oct</h1>'
              '<div class="t15 mut mt4">Mon 12 – Fri 16 Oct · day 2 of 5</div></div></div>' + b + '</div>'
            + '<div class="mt16" style="border-radius:10px;overflow:hidden">' + wb(LIS, 'Lisbon · 12–16 Oct · day 2 of 5 · 4 people · 3 countries') + '</div>')


def pot_row():
    return ('<div class="g2c mt16">'
            '<div class="mc"><div class="row sbw"><span class="ov">In the pot</span><span class="t13 mut">4 put in $800.00</span></div>'
            '<div class="hero mt4"><span class="d44">$446.00</span><span class="t17 m2">£331.06</span></div>'
            f'<div class="row sbw mt12"><span class="chip sm pos">You\'re owed £18.00</span><span class="t13 b row" style="gap:2px">Why{ic("chev", 16, 2.2)}</span></div></div>'
            '<div class="mc"><div class="row sbw"><span class="ov">Spent so far</span><span class="t13 mut">12 spends</span></div>'
            '<div class="hero mt4"><span class="d44">$354.00</span><span class="t17 m2">£262.77</span></div>'
            '<div class="row sbw mt12"><span class="t13 mut">Each person can spend $150 a day</span><span class="t13 b">Today: you $18</span></div></div>'
            '</div>')


MEMBERS = [('maya', 'Maya (you)', '+£18.00', 'pos', 'owed to you · $24.25'),
           ('sam', 'Sam', '$0.00', '', 'all square'),
           ('asha', 'Asha', '−₹676', 'neg', 'owes · −$8.08'),
           ('ben', 'Ben', '−£12.00', 'neg', 'owes · −$16.17')]


def members_row():
    cells = ''.join(f'<div class="mc"><div class="row">{av(k, 40, ring=(k == "maya"))}<div class="lm"><div class="lt">{n}</div>'
                    f'<div class="t13 mut">{P[k]["city"]}</div></div></div>'
                    f'<div class="d22 mt12 {c}">{v}</div><div class="t13 mut">{s}</div></div>' for k, n, v, c, s in MEMBERS)
    return f'<div class="row sbw mt20"><span class="d17">Who\'s ahead, who owes</span><span class="t13 mut">Each in their own money</span></div><div class="g4c mt8">{cells}</div>'


def bud(e, name, spent, total, pct, extra='', pend=0):
    p = f'<i class="pend" style="width:{pend}%"></i>' if pend else ''
    x = f'<div class="t11 inf b mt4">{extra}</div>' if extra else ''
    return (f'<div><div class="row sbw t13"><span class="b">{e} {name}</span><span class="mut tnum">{spent} of {total}</span></div>'
            f'<div class="bar mt4"><i style="width:{pct}%;background:var(--plan,var(--ink))"></i>{p}</div>{x}</div>')


BUDS = [('🛏️', 'Stay', '$240', '$300', 80, '', 0), ('🍽️', 'Food &amp; drink', '$96', '$120', 80, '', 0),
        ('🚋', 'Getting around', '$18', '$80', 22, '', 0), ('🎟️', 'Tickets &amp; activities', '$0', '$300', 0, '$250 waiting for an OK', 83)]


def budgets_card():
    return (f'<div class="mc mt16" style="--plan:{LIS}"><div class="row sbw"><span class="d17">Budgets</span>'
            f'<span class="t13 mut row" style="gap:2px">Rules{ic("chev", 16)}</span></div>'
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 28px;margin-top:12px">' + ''.join(bud(*b) for b in BUDS) + '</div></div>')


def plan_main():
    return plan_head() + pot_row() + members_row() + budgets_card()


def feed_items(hi=False):
    n = ' new' if hi else ''
    return ('<div class="feed">'
            + li(av('sam', 36), 'Sam paid $36.00 · Dinner at Taberna', 'Food &amp; drink · split 3 · Asha said OK · your share £8.91', '', '2 min', n)
            + li(av('asha', 36), 'Asha wants $250.00 · Boat trip', '<span class="inf b">Needs 1 more OK · Ben said OK</span>', btn('Review', 'sec', cls='sm', style='height:36px'), '')
            + li(av('maya', 36), 'You paid $18.00 · Tram passes', 'Getting around · split 3 · went through now', '', '1 h')
            + li(av('ben', 36), 'Ben paid $240.00 · Villa deposit', 'Stay · split 4 · Sam and Asha said OK', '', 'Mon')
            + li(av('asha', 36), 'Asha joined', 'Bengaluru 🇮🇳 · added $200.00', '', 'Mon')
            + li(av('sam', 36), 'Sam joined', 'New York 🇺🇸 · added $200.00', '', 'Sun')
            + li(av('maya', 36), 'You started the plan', 'Balanced rules · added $200.00', '', 'Sun')
            + '</div>')


def live_side():
    return (f'<div class="row sbw"><span class="d22 row" style="gap:10px"><span class="dot"></span>Live</span><span class="t13 b mut">All spends</span></div>'
            '<div class="tabsx mt12"><span class="on">Feed</span><span>Needs you · 1</span><span>Photos</span></div>'
            '<div class="mt8">' + feed_items() + '</div>'
            '<div class="sp"></div><p class="t13 mut" style="margin:8px 0 0">New spends appear here as they happen. Nothing moves or animates; the newest row is outlined for 4 seconds.</p>')


def request_side():
    return (f'<div class="row sbw"><span class="ov">Needs your OK</span><span class="ib" style="width:36px;height:36px">{ic("x", 20)}</span></div>'
            f'<div class="row mt8">{av("asha", 44)}<div><div class="lt">Asha · Lisbon, 12–16 Oct</div><div class="t13 mut">Asked at 13:10 · 22 h left</div></div></div>'
            '<h2 class="d28 mt16">Asha wants $250 for the boat trip</h2>'
            '<div class="t17 m2 mt4">£185.57 · your share £46.39</div>'
            '<div class="card t mt12" style="padding:12px 14px"><p class="t15" style="margin:0">“Sunset boat, 3 hours, drinks included. They need it by 6pm to hold the slot.”</p></div>'
            f'<div class="li" style="min-height:60px"><span class="thumb" style="width:44px;height:44px"><i></i></span><div class="lm"><div class="lt">Quote from Sunset Boats Lisboa</div><div class="t13 mut">Photo · only the plan can see it</div></div>{ic("chev", 18)}</div>'
            '<div class="col8 t13 mt4">'
            '<div class="row sbw"><span class="mut">Category</span><span class="b">🎟️ Tickets &amp; activities</span></div>'
            '<div class="row sbw"><span class="mut">Split</span><span class="b">Everyone · $62.50 each</span></div>'
            '<div><div class="row sbw"><span class="mut">Budget after this</span><span class="b">$250 of $300</span></div><div class="bar mt4"><i style="width:83%;background:var(--ink)"></i></div></div>'
            '<div class="row sbw"><span class="mut">Rule</span><span class="b">Over $200 needs 3 of 4</span></div></div>'
            f'<div class="bn k-pos mt12"><span class="bi">{ic("check", 22, 2.4)}</span><div><b>Ben said OK</b><span>With Asha\'s, yours makes 3 of 4, so it\'s paid straight away.</span></div></div>'
            '<div class="row sbw mt16"><span class="ov">Votes · needs 3 of 4</span><span class="vbar"><i class="y"></i><i class="y"></i><i></i><i></i></span></div>'
            + ''.join(f'<div class="row sbw" style="min-height:34px"><span class="row t15" style="gap:10px">{av(k, 26, flag=False)}{n}</span>{v}</div>' for k, n, v in [
                ('asha', 'Asha', '<span class="mut t13">Asked · counts as yes</span>'),
                ('ben', 'Ben', f'<span class="pos row b t13" style="gap:4px">{ic("check", 15, 2.6)}OK · 13:22</span>'),
                ('sam', 'Sam', '<span class="mut t13">Not yet</span>'), ('maya', 'You', '<span class="mut t13">Not yet</span>')])
            + '<div class="sp"></div><div class="btns mt12">' + btn('Reject', 'dngo') + btn('Approve', 'pri', 'key') + '</div>')


# ================================================================== 101 IA diagram
def wire(theme):
    def box(w, h, label, cls='', extra=''):
        return f'<div class="wire {cls}" style="width:{w}px;height:{h}px;{extra}">{label}</div>'

    def col(title, sub, inner, w):
        return (f'<div style="width:{w}px"><div class="d22">{title}</div><div class="t13 mut" style="margin:2px 0 12px">{sub}</div>'
                f'<div style="border:1.5px solid var(--line);border-radius:12px;padding:10px;background:var(--surface);display:flex;gap:8px;height:330px">{inner}</div></div>')
    big = col('1440 and wider', 'Rail · content · detail panel', box(96, 310, 'Nav rail<br>248 px') + box(250, 310, 'Main<br>flexible') + box(120, 310, 'Detail &amp; live<br>400 px'), 500)
    mid = col('1024 to 1439', 'Icon rail · content · panel opens over', box(36, 310, 'Rail<br>72') + box(220, 310, 'Main') + box(90, 310, 'Panel slides in on demand', extra='border-style:dotted'), 380)
    sm = col('Below 760', 'The approved phone screens', '<div style="display:flex;flex-direction:column;gap:8px;width:100%">' + box(200, 260, 'Phone layout<br>01–60, unchanged', extra='width:100%') + box(200, 34, 'Tab bar', extra='width:100%;height:42px') + '</div>', 220)
    rules = ('<div class="g3c mt24" style="gap:16px">'
             '<div class="mc t"><div class="lt">One URL per thing</div><div class="t13 mut mt4">/app/plan/7kq2, /app/plan/7kq2/spend/41. Plan IDs, never names: names are scrambled and only members can read them.</div></div>'
             '<div class="mc t"><div class="lt">Keyboard first</div><div class="t13 mut mt4"><span class="kbd">N</span> new spend · <span class="kbd">/</span> search · <span class="kbd">Esc</span> closes the panel · <span class="kbd">G</span> <span class="kbd">A</span> Activity.</div></div>'
             '<div class="mc t"><div class="lt">No motion</div><div class="t13 mut mt4">No page transitions or count-ups. Live rows get a 4-second outline. Focus rings use marigold.</div></div>'
             '</div>')
    body = (f'<div style="padding:36px 48px;width:100%"><div class="ov">Plans web app · information architecture</div>'
            '<h2 class="d34 mt8">Same four places as the phone. More of each on screen.</h2>'
            '<p class="t17 mut" style="margin:8px 0 24px;max-width:900px">Plans, Send, Activity and You live in a left rail. The middle shows the place you\'re in. A right panel shows what is live, or the detail you opened, so you never lose your place.</p>'
            f'<div class="row" style="align-items:flex-start;gap:40px">{big}{mid}{sm}</div>{rules}</div>')
    return f'<div class="lap fx {theme}" style="height:740px"><div class="vp" style="background:var(--bg)">{body}</div></div>'


section('A', 'Web app on a laptop',
        'Plans at plans.0xo.in/app fills a laptop screen: rail, content, live panel. Passkeys work through the browser. No phone-width column, no dead space, no motion.',
        note='<b>Breakpoints.</b> ≥ 1440: rail 248 + main + panel 400 (drawn here). 1024–1439: the rail collapses to 72 px icons with tooltips; the right panel becomes an overlay that opens from feed items, Review buttons and receipts, and closes with Esc. 760–1023 (tablets): main only, with the bottom tab bar from the phone and the panel as a bottom sheet. Below 760: the approved phone screens 01–60 exactly (see 119–121). The installed PWA has no browser bar but the same layout.')

item('A', '101', 'Layout and breakpoints',
     'The desktop information architecture in one picture: what sits where at each width, and the three rules every laptop screen follows.',
     '', '', 'Tablet (1024) keeps the main column at full width and opens the panel over it; nothing else changes.',
     ('w', 1440, 1), wire)

# ------------------------------------------------------------------ 102 Welcome
WELCOME_ILLO = ('<div style="position:relative;width:720px;flex:none;overflow:hidden;background:var(--surface-2)">'
                + lband(W['lagoon'], 'LISBON · 12–16 OCT · 4 PEOPLE', 110, -300, -11)
                + lband(W['orchid'], 'GLASTONBURY CREW · 24–28 JUN', 260, -200, 6)
                + lband(W['marigold'], "BEN'S 30TH · SAT 7 NOV", 410, -380, -5)
                + lband(W['lime'], 'SKI WEEK · FEB · 6 PEOPLE', 560, -240, 8)
                + av_at('maya', 76, 90, 150) + av_at('sam', 64, 560, 92) + av_at('asha', 72, 500, 400) + av_at('ben', 60, 140, 500)
                + '<div style="position:absolute;left:32px;bottom:28px" class="t13 mut">Every band is a real plan colour. Nothing moves.</div></div>')


def welcome_right(banner='', create=None):
    c = create if create is not None else btn('Create account', 'pri', 'key', 'lg')
    return ('<div style="flex:1;display:flex;flex-direction:column;padding:56px 88px 40px">'
            f'<div class="row sbw">{logo(26)}<span class="t13 b mut">What is Plans?</span></div>'
            '<div class="sp"></div>'
            '<h1 class="d56" style="font-size:64px">One pot for the<br>whole plan.</h1>'
            '<p class="t17 mut" style="font-size:19px;margin:16px 0 28px;max-width:520px">Friends anywhere chip in, spend under rules you agree, and settle up in one tap. Right here in your browser.</p>'
            + banner +
            f'<div style="width:400px">{c}' + btn('I already use Plans', 'sec', cls='lg mt8') + '</div>'
            '<p class="t13 mut" style="margin:14px 0 0;max-width:460px">No passwords. Your browser saves a passkey, unlocked with your fingerprint, face or screen lock. Your phone can do it instead.</p>'
            '<div class="sp"></div>'
            f'<div class="row" style="gap:14px"><div style="padding:6px;background:#fff;border-radius:10px">{qr("dl", 64)}</div>'
            '<div class="t13"><div class="b">Prefer your phone?</div><div class="mut">Scan to get the Android app. Same account on both.</div></div>'
            '<span class="sp"></span><span class="chip sm">Test version · free test dollars</span></div></div>')


def welcome_body(banner='', create=None):
    return WELCOME_ILLO + welcome_right(banner, create)


item('A', '102', 'Welcome: create account or come back',
     'The web app\'s front door. Split screen: the wristband bands on the left, one clear choice on the right. A QR offers the Android app for people who\'d rather use their phone.',
     'plans.0xo.in/app with no account in this browser; “Use Plans in your browser” on the landing page (131).',
     'Create account → browser passkey dialog (103, 105) → name, country, currency (same fields as 03, centred card). I already use Plans → 106.',
     'Default (shown). Passkey cancelled or failed → 130. Browsers without passkeys (very old) get 06\'s copy with “Use the Android app instead”.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body()))

item('A', '103', 'Create passkey: Chrome dialog',
     'Chrome\'s own dialog, drawn faithfully but generically so the copy around it makes sense. Plans doesn\'t draw this; it shows what people will see.',
     '102 → Create account in Chrome (or Edge, which looks the same).',
     'Create → the computer asks for Touch ID, Windows Hello or the screen lock → name, country, currency → empty home. Use a phone or tablet → 104. Cancel → 130.',
     'If the person has several Google accounts, the account row becomes a picker. On Windows the dialog may be Windows Hello\'s instead; same three outcomes.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body(), over=chrome_create()))

item('A', '104', 'Create passkey: “Use a phone or tablet”',
     'For laptops without a fingerprint reader or screen lock: the passkey lives on the phone. Chrome shows a QR; the phone\'s camera does the rest.',
     '103 → Use a phone or tablet.',
     'Phone confirms → back to the laptop, account created, the passkey stays on the phone. Back → 103. Cancel → 130.',
     'Bluetooth off: Chrome says so in the dialog. Each later confirm on this laptop asks for the phone again, so the You page (118) suggests saving a passkey on the computer too.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body(), over=chrome_create(True)))

item('A', '105', 'Create passkey: Safari on a Mac',
     'Safari\'s sheet drops from the toolbar and saves to iCloud Keychain. Same outcomes as Chrome, Apple wording.',
     '102 → Create account in Safari.',
     'Continue → Touch ID or the Mac password → name, country, currency. Other Options → use a phone, tablet or security key (QR, like 104). Cancel → 130.',
     'iPhone and iPad Safari show Apple\'s bottom sheet instead; the Plans side is identical.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body(), over=safari_create(), browser='safari'))

item('A', '106', 'Restore: choose a passkey',
     'Coming back on a new computer. The browser lists passkeys saved for plans.0xo.in, including ones synced from the person\'s phone.',
     '102 → I already use Plans.',
     'Continue → fingerprint or screen lock → 107. Use a phone or tablet → QR as in 104, using the Android phone\'s passkey. Cancel → 130 with “You weren\'t signed in to anything”.',
     'No passkeys found: the browser says so; Plans shows “Create account instead” plus a link to What could go wrong (143).',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body(), over=chrome_pick()))


def restore_ok():
    card = ('<div class="mc" style="width:560px;padding:32px">'
            f'<div class="bigic p" style="margin:0">{ic("check", 36, 2.4)}</div>'
            '<h2 class="d34 mt16">Welcome back, Maya</h2>'
            '<p class="t17 mut" style="margin:8px 0 18px">We found your Plans account and rebuilt everything in this browser.</p>'
            + li(emo('🌊', W['lagoon'], 44), 'Lisbon, 12–16 Oct', 'Active · 4 people', '<span class="pos">+£18.00</span>', 'owed to you')
            + li(emo('🎪', W['orchid'], 44), 'Glastonbury crew', 'Ended · 5 people', '<span class="neg">−£8.91</span>', 'you owe')
            + li(tile('ticket'), 'Your Plans account', 'Balance', '$5.00', '£3.71')
            + f'<div class="card t mt16" style="padding:12px 14px"><div class="row">{fp()}<span class="t13 mut lm">Same key as your phone, so receipts and notes open here too.</span></div></div>'
            + '<div class="mt20" style="width:240px">' + btn('Go to my plans', 'pri') + '</div></div>')
    return (WELCOME_ILLO + f'<div style="flex:1;display:grid;place-items:center">{card}</div>')


item('A', '107', 'Restore: welcome back',
     'The account came back. Everything was rebuilt from the same key, so private receipts open in this browser.',
     '106 after the fingerprint or screen lock.',
     'Go to my plans → 108.',
     'Rebuilding: rows show skeletons for up to ~2 s. A plan that fails to load shows “Try again” on its row only.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', restore_ok()))

# ------------------------------------------------------------------ 108 Home
def home_main():
    lis = ('<div class="pc">' + wb(W['lagoon'], 'Lisbon · 12–16 Oct · day 2 of 5') +
           f'<div class="pcb"><div class="row">{emo("🌊", W["lagoon"])}<div class="lm"><div class="d17" style="font-size:19px">Lisbon, 12–16 Oct</div>'
           f'<div class="t13 mut">Pot $446.00 · £331.06</div></div>{avs(["maya", "sam", "asha", "ben"], 26)}</div>'
           '<div class="row sbw mt16"><span class="chip sm pos">You\'re owed £18.00</span>'
           '<span class="t13 mut row" style="gap:8px"><span class="dot"></span>Sam paid $36 · 2 min</span></div></div></div>')
    gla = ('<div class="pc">' + wb(W['orchid'], 'Glastonbury crew · ended 28 Jun') +
           f'<div class="pcb"><div class="row">{emo("🎪", W["orchid"])}<div class="lm"><div class="d17" style="font-size:19px">Glastonbury crew</div>'
           '<div class="t13 mut">Settled · 5 people</div></div></div>'
           '<div class="row sbw mt16"><span class="chip sm neg">You owe £8.91</span>'
           f'<span class="t13 bb row" style="gap:2px">Pay now{ic("chev", 16, 2.2)}</span></div></div></div>')
    tr = ('<div class="mc" style="border:1.5px dashed var(--line);background:transparent">'
          f'<div class="row" style="align-items:flex-start">{tile("sparkle", "a")}<div class="lm"><div class="lt">Try a settle-up</div>'
          '<div class="t13 mut">A 2-minute trip with three demo friends. Test dollars only.</div></div>'
          f'<span class="mut">{ic("x", 18)}</span></div>' + btn('Start demo', 'sec', cls='sm mt12') + '</div>')
    new = ('<div class="mc" style="border:1.5px dashed var(--line);background:transparent;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;min-height:150px">'
           f'<span class="ib f">{ic("plus", 22)}</span><div class="lt">New plan</div><div class="t13 mut">Trip, festival, house share</div></div>')
    return ('<div class="mh"><div><div class="t15 mut">Good afternoon, Maya</div><div class="d44">Your plans</div></div>'
            '<div class="btns">' + btn('Join with a link', 'sec', 'link', 'sm') + btn('New plan', 'pri', 'plus', 'sm') + '</div></div>'
            '<div class="mc mt20"><div class="row" style="gap:24px"><div class="lm"><div class="row" style="gap:10px"><span class="ov">Your Plans account</span>' + AUSD + '</div>'
            '<div class="hero mt4"><span class="d44">$5.00</span><span class="t17 m2">£3.71</span></div></div>'
            '<div class="btns" style="flex:none">' + btn('Send', 'pri', 'send', 'sm') + btn('Add', 'sec', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm') + '</div></div></div>'
            '<div class="row sbw mt24"><span class="d22">Plans</span><span class="t13 mut">2 plans · 1 active</span></div>'
            f'<div class="g2c mt12">{lis}{gla}{tr}{new}</div>'
            '<div class="row sbw mt24"><span class="d22">Recent money</span><span class="t13 b mut">See all</span></div>'
            '<div class="mc mt8" style="padding:2px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 20px">'
            + li(tile('in', 'p'), 'Added', 'Tue 13 Oct', '<span class="pos">+$20.00</span>', '', 'nb')
            + li(tile('out'), 'To Lisbon', 'Mon 12 Oct', '−$200.00', '', 'nb')
            + li(tile('in', 'p'), 'From Ben', 'Sun 11 Oct', '<span class="pos">+$12.00</span>', '', 'nb') + '</div>')


def home_side():
    return ('<div class="d22">Needs you</div>'
            f'<div class="card mt12"><div class="row" style="align-items:flex-start">{av("asha", 40)}<div class="lm"><div class="lt">Asha wants $250 for the boat trip</div>'
            '<div class="t13 mut">Lisbon · Ben said OK · 22 h left</div></div></div>'
            '<div class="btns mt12">' + btn('Reject', 'out', cls='sm') + btn('Review', 'pri', cls='sm') + '</div></div>'
            f'<div class="card mt8"><div class="row">{av("ben", 40)}<div class="lm"><div class="lt">Ben suggests a rule change</div>'
            '<div class="t13 mut">Lisbon · Food budget $120 → $180</div></div>' + btn('Vote', 'sec', cls='sm') + '</div></div>'
            '<div class="row sbw mt24"><span class="d17 row" style="gap:10px"><span class="dot"></span>Live across your plans</span></div>'
            '<div class="feed mt4">'
            + li(av('sam', 36), 'Sam paid $36.00 · Dinner', 'Lisbon · your share £8.91', '', '2 min')
            + li(av('maya', 36), 'You paid $18.00 · Tram passes', 'Lisbon · split 3', '', '1 h')
            + li(tile('in', 'p'), 'You added £20 to Lisbon', 'The pot got $26.94', '', '09:12')
            + li(av('ben', 36), 'Ben paid $240.00 · Villa', 'Lisbon · split 4', '', 'Mon')
            + li(emo('🎪', W['orchid'], 36), 'Glastonbury is settled', 'You owe Ben £8.91', '', '28 Jun')
            + '</div>')


item('A', '108', 'Home',
     'Balance across the top, plans as cards, and a right panel that puts what needs you above what\'s new. Nothing on this page is wider than it needs to be: cards fill a two-column grid.',
     'After sign-up or restore; Plans in the rail; the logo.',
     'Plan card → 109. Review → 111. Send → 114. Add → top-up (55 on test). Start demo → 56 in a centred column. New plan → 10–11 as a two-step centred form with the live preview card beside it.',
     'Empty (first run): the grid shows “No plans yet” with New plan and Join as two big cards, as 08. With 6+ plans the grid becomes three columns at 1680+.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', shell('plans', home_main(), home_side())))

item('A', '109', 'Plan home',
     'The plan at a glance: pot and spending side by side, every member\'s position in their own money, budgets in two columns, and the live feed alongside so spends land while you read.',
     'Home plan card; rail plan list; notifications; /app/plan/7kq2.',
     'Pay → 110. Review → 111. Members &amp; rules → 17 in the main column. Feed row → spend detail in the right panel (29 content). Why → explanation in the panel.',
     'Paused: red banner under the wristband and Pay disabled, as 34. Offline: grey banner and Pay disabled, as 58. Loading: skeletons in this exact shape, as 60.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2', shell('plans', plan_main(), live_side(), plan='lis')))

# ------------------------------------------------------------------ 110 Spend
CATS = [('🛏️', 'Stay'), ('✈️', 'Travel'), ('🚋', 'Getting around'), ('🍽️', 'Food &amp; drink'), ('🎟️', 'Tickets &amp; activities'),
        ('🛒', 'Groceries'), ('🛍️', 'Shopping'), ('✨', 'Other')]


def spend_main():
    cats = ''.join(chip(f'{e} {n}', 'on' if n == 'Getting around' else '') for e, n in CATS)
    return (crumb('Plans', 'Lisbon, 12–16 Oct', 'Pay')
            + '<div class="mh"><div><h1 class="d34">Pay from the pot</h1><div class="t15 mut mt4">Lisbon · $446.00 left</div></div></div>'
            + f'<div class="mc mt16 row">{emo("🚋", W["marigold"], 48)}<div class="lm"><div class="lt">Rossio Tram Kiosk</div><div class="t13 mut">Business · paid before · Getting around</div></div><span class="t13 b mut">Change</span></div>'
            + '<div class="row mt16" style="gap:20px;align-items:flex-end"><div><div class="ov">Amount</div><div class="d56 mt4">$18.00<span class="caret" style="display:inline-block;width:3px;height:48px;background:var(--accent);vertical-align:-6px;margin-left:2px"></span></div></div>'
              f'<div style="padding-bottom:8px"><div class="t17 m2">£13.36</div><span class="chip sm ol mt4">{ic("swap", 14, 2)}Type in pounds</span></div></div>'
            + f'<div class="ov mt20">Category</div><div class="wrapc mt8">{cats}</div>'
            + '<div class="ov mt20">Split</div><div class="row mt8" style="gap:8px">' + chip('Everyone (4)') + chip('3 people', 'on') + chip('Custom')
            + f'<span class="row t13" style="gap:8px;margin-left:8px">{avs(["maya", "sam", "asha"], 24)}<span class="mut">Maya, Sam, Asha · <b style="color:var(--ink)">$6.00 each</b> · £4.45</span></span></div>'
            + '<div class="g2c mt20">' + field('Note', '3-day tram passes')
            + f'<div class="fld"><span class="thumb" style="width:40px;height:40px"><i></i></span><div><label>Receipt photo</label><div class="fv" style="font-size:15px">Only the plan can see it</div></div></div></div>'
            + '<div class="ov mt20">Who shares it</div><div class="g3c mt8">'
            + ''.join(f'<div class="mc row" style="padding:10px 12px">{av(k, 32)}<div class="lm"><div class="lt">{n}</div><div class="t13 mut">{a}</div></div></div>'
                      for k, n, a in [('maya', 'Maya (you)', '$6.00 · £4.45'), ('sam', 'Sam', '$6.00'), ('asha', 'Asha', '$6.00 · ₹502')]) + '</div>')


def spend_side():
    return ('<div class="ov">What will happen</div>'
            + '<div class="mt8">' + bn('pos', 'zap', 'Goes through now', 'Under $25, so nobody needs to OK it. Sam and Asha see it straight away.') + '</div>'
            + '<div class="mt16" style="position:relative"><div class="tiers" style="height:34px"><span style="flex:1;background:#BFE3CF">Now</span><span style="flex:2.2;background:#BFD5EA">1 OK</span><span style="flex:1.4;background:#F8D892">3 of 4</span></div>'
              '<div style="position:absolute;left:17%;top:-6px;width:3px;height:46px;border-radius:2px;background:var(--ink)"></div>'
              '<div class="row mono t11 mut mt4" style="gap:0"><span style="width:21.7%">$0</span><span style="width:47.8%">$25</span><span>$200</span></div>'
              '<div class="mono t11 b" style="position:absolute;left:calc(17% - 12px);top:-24px">$18</div></div>'
            + '<div class="col8 mt16 t15">'
            + ''.join(f'<div class="row" style="gap:10px;align-items:flex-start"><span class="pos" style="margin-top:1px">{ic("check", 18, 2.4)}</span><span>{t}</span></div>' for t in [
                'Getting around has <b>$62</b> left after this',
                'You can spend <b>$132</b> more today',
                'The pot keeps <b>$428.00</b> · £317.70',
                'Businesses can be paid in this plan'])
            + '</div>'
            + f'<div class="mt20" style="--plan:{LIS}">' + bud('🚋', 'Getting around after this', '$18', '$80', 22)
            + '<div class="mt12">' + bud('👤', 'Your spending today', '$18', '$150', 12) + '</div></div>'
            + '<div class="sp"></div>'
            + '<div class="card t" style="padding:12px 14px"><div class="row sbw t15"><span class="mut">You pay</span><span class="b">$18.00 · £13.36</span></div>'
              '<div class="row sbw t13 mt4"><span class="mut">From</span><span>Lisbon pot</span></div></div>'
            + btn('Confirm with passkey', 'pri', 'key', 'lg mt12')
            + '<p class="t13 mut c" style="margin:8px 0 0">Your browser asks for your fingerprint, face or screen lock.</p>')


item('A', '110', 'Spend form and rule preview',
     'Everything on one screen: the form in the middle, and in the panel the rule preview that says exactly what will happen before you confirm, with each check spelled out.',
     '109 → Pay, or <span class="kbd">N</span> anywhere in a plan.',
     'Confirm with passkey → browser dialog → receipt in the panel (24 content) and the new row at the top of the feed. Over $25 → panel says “Needs 1 OK” and the button becomes “Ask for an OK” (22a).',
     'Blocked states use 22b/22c copy in the panel and disable the button. On phones the button says “Confirm with fingerprint”; on computers “Confirm with passkey”, because laptops may use a face, PIN or phone.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2/pay', shell('plans', spend_main(), spend_side(), plan='lis')))

item('A', '111', 'Approval',
     'The request opens in the right panel, so the plan stays visible behind it: you can check the budget and who owes before you decide.',
     'Review on a feed row (109); Activity (117); browser notification “Asha wants $250 for the boat trip”.',
     'Approve → passkey → panel shows the approved timeline and receipt (28). Reject → reason chips in the panel (27b). Esc or × → back to Live.',
     'Already decided by others: the panel shows the result instead of buttons. Expired: “This request ran out. Asha can ask again.”',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2/request/12', shell('plans', plan_main(), request_side(), plan='lis')))

# ------------------------------------------------------------------ 112 / 113 Settle
def payout(k, name, a, b):
    return li(av(k, 44), f'{name}<div class="t13 mut" style="font-weight:400">{P[k]["city"]} {P[k]["f"]}</div>', '', f'<span class="d22">{a}</span>', b)


def settle_main():
    return (crumb('Plans', 'Lisbon, 12–16 Oct', 'Settle up')
            + '<h1 class="d44">Here\'s who gets what</h1><p class="t17 mut" style="margin:8px 0 16px">Everyone is paid at once, in their own money.</p>'
            + '<div class="g2c" style="grid-template-columns:1.1fr 1fr;align-items:start">'
            + '<div class="mc" style="padding-top:4px;padding-bottom:4px">'
            + payout('maya', 'Maya (you)', '£38.86', '$52.35') + payout('sam', 'Sam', '$28.10', 'dollars')
            + payout('asha', 'Asha', '₹1,674', '$20.02') + payout('ben', 'Ben', '£8.86', '$11.93') + '</div>'
            + '<div class="mc" style="padding-top:26px"><div class="ov" style="margin:-10px 0 18px">How we got there</div>' + edge('ben', 'maya', '£12.00') + '<div style="height:16px"></div>' + edge('asha', 'maya', '₹676 · £6.00')
            + '<p class="t13 mut" style="margin:14px 0 0">Then the $112.40 left in the pot is shared 4 ways, $28.10 each.</p></div>'
            + '</div>'
            + '<div class="g2c mt16" style="grid-template-columns:1.1fr 1fr;align-items:start">'
            + f'<div class="mc" style="--plan:{LIS}"><div class="ov">Where the $687.60 went</div>'
            + ''.join(f'<div class="mt12"><div class="row sbw t13"><span class="b">{n}</span><span class="mut">{v}</span></div><div class="bar mt4"><i style="width:{p}%;background:var(--plan)"></i></div></div>'
                      for n, v, p in [('🎟️ Tickets &amp; activities', '$250.00', 100), ('🛏️ Stay', '$240.00', 96), ('🍽️ Food &amp; drink', '$147.60', 59), ('🚋 Getting around', '$50.00', 20)])
            + '</div><div class="mc"><div class="ov">When you press Settle up</div><div class="col8 mt12 t15">'
            + '<div class="step"><span class="n">1</span><div>Everyone is paid at once, in their own money.</div></div>'
            + '<div class="step"><span class="n">2</span><div>The plan becomes read-only. Nobody can spend from it again.</div></div>'
            + '<div class="step"><span class="n">3</span><div>Everyone gets the same receipt, with Proof.</div></div></div></div></div>'
            + '<div class="mono t11 mut mt12">Rates ECB 14:05 UTC · GBP 1.3472 · INR 83.60 · locked when you press</div>')


def settle_side():
    return ('<div class="d22">Ready to settle</div>'
            '<div class="g3c mt12" style="gap:8px">'
            '<div class="mc t" style="padding:10px 12px"><div class="ov">Spent</div><div class="d17 mt4">$687.60</div></div>'
            '<div class="mc t" style="padding:10px 12px"><div class="ov">Left</div><div class="d17 mt4">$112.40</div></div>'
            '<div class="mc t" style="padding:10px 12px"><div class="ov">Spends</div><div class="d17 mt4">18</div></div></div>'
            '<div class="ov mt20">Everyone checked · 4 of 4</div>'
            + ''.join(li(av(k, 32), P[k]['n'], '', f'<span class="pos row b" style="gap:4px">{ic("check", 16, 2.4)}Looks right</span>') for k in ['sam', 'asha', 'ben', 'maya'])
            + '<div class="mt12">' + bn('inf', 'shield', 'Nobody needs their safety net', 'The pot covers every payout.') + '</div>'
            + '<div class="sp"></div>' + btn('Settle up · one tap', 'pri', 'key', 'lg')
            + '<p class="t13 mut c" style="margin:8px 0 0">Anyone in the plan can press it. It only runs once.</p>')


item('A', '112', 'Settle-up preview',
     'Who gets what, in their own money, next to the two arrows that explain why. The panel confirms everyone checked and holds the one button.',
     '109 when the plan has ended and everyone said “Looks right” (37), or 24 h passed.',
     'Settle up → passkey → the panel shows the 39 progress list, then 113.',
     'Safety net needed: the arrow is labelled “from safety net”, and the panel lists whose. Open question on a spend: button disabled with “Wait for the vote on Late-night snacks”.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2/settle', shell('plans', settle_main(), settle_side(), plan='lis')))


def settled_main():
    conf = ''.join(f'<span class="conf" style="left:{x}px;top:{y}px;background:{c};transform:rotate({r}deg)"></span>'
                   for x, y, c, r in [(60, 40, W['lagoon'], 20), (160, 120, W['marigold'], -30), (640, 50, W['orchid'], 45), (700, 140, W['lime'], -15),
                                      (420, 30, W['coral'], 30), (90, 300, W['iris'], 60), (690, 330, W['marigold'], 10)])
    return (f'<div style="position:absolute;inset:0;pointer-events:none;opacity:.8">{conf}</div>'
            + f'<div class="c mt16"><div class="bigic p">{ic("check", 36, 2.4)}</div><h1 class="d44 mt12">All settled</h1>'
              f'<span class="chip sm pos mt8">{ic("zap", 14, 2.2)}Settled in 0.6 s</span></div>'
            + '<div style="width:480px;margin:20px auto 0">' + stub('<div class="row sbw"><span class="ov">Lisbon, 12–16 Oct · settle-up</span><span>🌊</span></div>'
                   '<div class="d28 mt8">$112.40 paid out</div>',
                   [('Maya · London', '<b>£38.86</b>'), ('Sam · New York', '<b>$28.10</b>'), ('Asha · Bengaluru', '<b>₹1,674</b>'), ('Ben · Manchester', '<b>£8.86</b>'),
                    ('', 'Rates ECB 14:05 UTC · GBP 1.3472 · INR 83.60'), ('Network cost', '$0.0008, covered by Plans')],
                   f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}') + '</div>'
            + '<div class="g4c" style="width:640px;margin:20px auto 0">'
            + ''.join(f'<div class="mc" style="padding:12px 14px"><div class="d22">{v}</div><div class="t13 mut">{l}</div></div>' for v, l in
                      [('$687.60', 'spent together'), ('18', 'spends'), ('$250', 'biggest: boat'), ('3', 'countries')]) + '</div>')


def mini_card():
    return ('<div style="border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--bg);position:relative;height:200px;padding:16px">'
            f'<div class="band" style="--w:{LIS};width:700px;height:30px;font-size:9px;top:118px;left:-40px;transform:rotate(-5deg);gap:20px"><span>SETTLED · 17 OCT</span><i style="width:14px;height:14px"></i><span>SETTLED · 17 OCT</span></div>'
            f'<div class="row sbw">{logo(14)}<span class="mono t11 mut">plans.0xo.in/s/7kq2</span></div>'
            '<div class="d22 mt8" style="max-width:250px">4 friends · 3 countries · settled in one tap</div>'
            '<div class="row t15" style="gap:6px;position:absolute;left:16px;bottom:14px">🇬🇧🇺🇸🇮🇳<span class="mono t11 b" style="margin-left:auto">0.6 s</span></div></div>')


def settled_side(theme):
    return ('<div class="d22">Share how it went</div>'
            '<p class="t13 mut" style="margin:4px 0 12px">A card and a public page with counts, countries and amounts. No names, no photos unless you turn them on.</p>'
            + f'<div class="row" style="gap:14px;align-items:flex-start"><div style="zoom:.15;flex:none">{share_portrait(theme)}</div>'
            '<div class="lm t13"><div class="lt">Story · 4:5</div><div class="mut mt4">Also as a wide link preview. The link opens a public proof page.</div>'
            '<div class="mono t11 mt8">plans.0xo.in/s/7kq2</div></div></div>'
            + '<div class="mt12">' + li('', 'Show the plan name', 'Off: the card says “4 friends”', toggle(False)) + li('', 'Show photos', 'Off: no receipts or photos', toggle(False)) + '</div>'
            + '<div class="btns mt12">' + btn('Copy link', 'sec', 'copy', 'sm') + btn('Download image', 'sec', 'download', 'sm') + '</div>'
            + '<div class="sp"></div>' + btn('Download summary (PDF, CSV)', 'out', 'download')
            + btn('Done', 'pri', cls='mt8'))


item('A', '113', 'Settled',
     'The stub in the middle, the share card in the panel. Sharing is one click, and private by default.',
     '112 after settling (usually under a second).',
     'Share options → 136 (same choices). Copy link → plans.0xo.in/s/7kq2 (138). Done → the plan becomes the read-only memory (41) in the main column.',
     'Everyone gets a browser notification: “Lisbon is settled. You got £38.86.” If it takes over 5 s the panel says “Still confirming…” and never says Done early.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2/settled', shell('plans', settled_main(), settled_side(t), plan='lis')))

# ------------------------------------------------------------------ 114 / 115 Send
def send_left(sel='sam'):
    def pr(k, sub):
        on = ' style="background:var(--surface-2);border-radius:12px;padding:8px 10px;margin:0 -10px;border-bottom:0"' if k == sel else ''
        return f'<div class="li"{on}>{av(k, 40)}<div class="lm"><div class="lt">{P[k]["n"]}</div><div class="t13 mut">{sub}</div></div></div>'
    return ('<div style="width:300px;flex:none">'
            '<div class="mc"><div class="ov">You can send</div><div class="hero mt4"><span class="d28">$5.00</span><span class="t15 m2">£3.71</span></div><div class="mt8">' + AUSD + '</div></div>'
            + '<div class="mt12">' + field('', f'<span class="mut row" style="gap:8px;font-size:15px">{ic("search", 18)}Name, Plans code or phone</span>') + '</div>'
            + '<div class="ov mt16">Recent</div>'
            + pr('sam', 'New York · gets dollars') + pr('asha', 'Bengaluru · gets rupees') + pr('ben', 'Manchester · gets pounds')
            + pr('ines', 'Lisbon · gets euros') + pr('kai', 'Berlin · gets euros')
            + f'<div class="row mt12" style="gap:8px">{btn("Send by link", "sec", "link", "sm")}{btn("My code", "sec", "qr", "sm")}</div></div>')


def send_main():
    amt = ('<div class="mc" style="flex:1;padding:28px">'
           f'<div class="row">{av("sam", 44)}<div class="lm"><div class="lt">To Sam</div><div class="t13 mut">New York · gets dollars</div></div></div>'
           '<div class="c" style="margin-top:36px"><div class="d56" style="font-size:72px">£1.50<span style="display:inline-block;width:3px;height:60px;background:var(--accent);vertical-align:-8px;margin-left:2px"></span></div>'
           '<div class="mt8" style="font-size:24px">Sam gets <b>$2.02</b></div><div class="mt8">' + RATE + '</div>'
           f'<span class="chip sm ol mt12">{ic("swap", 14, 2)}Type in dollars</span></div>'
           '<div class="mt24">' + field('Note', 'Coffee ☕') + '</div>'
           f'<div class="row mt16" style="justify-content:center"><span class="chip sm pos">{ic("zap", 14, 2.2)}No fee · arrives in under a second</span></div></div>')
    return ('<div class="mh"><h1 class="d44">Send</h1><span class="t13 mut">To anyone on Plans, in any country</span></div>'
            f'<div class="row mt16" style="gap:20px;align-items:stretch;flex:1;min-height:0">{send_left()}{amt}</div>')


def send_side():
    return ('<div class="d22">Check and send</div>'
            f'<div class="row mt16" style="justify-content:center;gap:16px">{av("maya", 52)}<span class="mut">{ic("chev", 26, 2)}</span>{av("sam", 52)}</div>'
            '<div class="c mt12"><div class="d34">£1.50</div><div class="t15 mt4">Sam gets <b>$2.02</b> in New York</div></div>'
            '<div class="card mt16 col8 t15">'
            '<div class="row sbw"><span class="mut">You send</span><span class="b">£1.50</span></div>'
            '<div class="row sbw"><span class="mut">Sam gets</span><span class="b">$2.02</span></div>'
            '<div class="row sbw"><span class="mut">Fee</span><span class="b">$0.00</span></div>'
            '<div class="row sbw"><span class="mut">Note</span><span class="b">Coffee ☕</span></div>' + RATE + '</div>'
            '<p class="t13 mut" style="margin:10px 0 0">The rate is held for 60 seconds. After that we refresh it and tell you.</p>'
            '<div class="ov mt20">What Sam will see</div>'
            f'<div class="card mt8"><div class="row">{av("maya", 40)}<div class="lm"><div class="lt pos">+$2.02</div><div class="t13 mut">from Maya, London · “Coffee ☕”</div></div><span class="t13 mut">now</span></div></div>'
            '<div class="sp"></div>' + btn('Confirm with passkey', 'pri', 'key', 'lg'))


item('A', '114', 'Send: amount in both currencies',
     'People on the left, the amount in the middle in your money with what Sam gets in his, and the check in the panel. Typing is the keyboard; there\'s no on-screen keypad.',
     'Send in the rail; Home → Send; <span class="kbd">S</span>.',
     'Confirm with passkey → browser dialog → 115. Pick another person → amount stays, conversion updates.',
     'Too much: panel shows 45b\'s banner with Add money. Rate older than 60 s: panel line turns amber “Rate refreshed”.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/send', shell('send', send_main(), send_side())))


def receipt_main():
    return ('<div class="mh"><h1 class="d44">Send</h1></div>'
            f'<div class="row mt16" style="gap:20px;align-items:flex-start;flex:1;min-height:0">{send_left()}'
            '<div style="flex:1"><div class="c"><div class="bigic p">' + ic('check', 36, 2.4) + '</div><h2 class="d34 mt12">Sent</h2>'
            '<p class="t15 mut" style="margin:6px 0 16px">Sam got $2.02 in New York.</p></div>'
            + stub('<div class="row sbw"><span class="ov">Plans · sent</span><span class="t13 mut mono">#7Q2-1405</span></div>'
                   f'<div class="row mt8" style="gap:10px"><span class="d34">£1.50</span><span class="mut">{ic("chev", 22, 2.4)}</span><span class="d34">$2.02</span></div>',
                   [('From', 'Maya · London 🇬🇧'), ('To', 'Sam · New York 🇺🇸'), ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC'),
                    ('Fee', '$0.00'), ('Note', 'Coffee ☕'), ('When', 'Tue 13 Oct · 14:05:12')],
                   f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}')
            + f'<div class="card t mt16"><div class="row">{av("sam", 36)}<div class="lm t13"><b>Sam was told straight away</b><div class="mut">“+$2.02 from Maya, London”</div></div></div></div>'
            + '</div></div>')


def receipt_side():
    return ('<div class="d22">Recent sends</div><div class="feed mt8">'
            + li(av('sam', 36), 'To Sam · Coffee ☕', 'Sam got $2.02 · now', '−£1.50', '', ' new')
            + li(av('asha', 36), 'To Asha · Train back', 'Asha got ₹1,672 · Sun', '−£14.85', '')
            + li(av('ben', 36), 'From Ben · Manchester', '+$12.00 · Sun', '<span class="pos">+£8.91</span>', '')
            + li(tile('in', 'p'), 'Added money', 'Test dollars · Tue', '<span class="pos">+$20.00</span>', '')
            + li(av('ines', 36), 'To Inês · Surfboard', 'Inês got €38.73 · Mon', '−£33.40', '')
            + li(av('kai', 36), 'From Kai · Berlin', '+$15.00 · 2 Oct', '<span class="pos">+£11.13</span>', '')
            + '</div><div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Send again', 'pri', 'send') + '</div>')


item('A', '115', 'Sent receipt',
     'The receipt as a ticket stub, with both currencies, the rate, the measured time and Proof. Recent sends sit in the panel with this one outlined.',
     '114 after the passkey.',
     'Proof → the public record in a new tab. Share → image of the stub. Send again → 114 with Sam.',
     'Over 5 s: “Still sending…” and the stub waits. Failure: 59\'s copy, “Your money didn\'t move”.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/send/7q2-1405', shell('send', receipt_main(), receipt_side())))

# ------------------------------------------------------------------ 116 Claim
def site_top(right=''):
    r = right or btn('Open the app', 'sec', cls='sm')
    return (f'<div class="row sbw" style="height:72px;padding:0 48px;border-bottom:1px solid var(--line);background:var(--surface)">{logo(24)}'
            f'<div class="row" style="gap:24px"><span class="t15 b mut">What is Plans?</span><span class="t15 b mut">Help</span>{r}</div></div>')


def claim_body():
    left = ('<div style="width:520px">' + stub(f'<div class="row">{av("maya", 48)}<div><div class="lt">Maya sent you</div><div class="t13 mut">London 🇬🇧</div></div></div>'
                                              '<div class="mt16"><span class="d56" style="font-size:72px">$25</span> <span class="d28 m2">(≈ ₹2,090)</span></div>'
                                              '<p class="t17" style="margin:10px 0 0">“For the train tickets 🚆”</p>',
                                              [('Expires', 'Tue 20 Oct · 6 days left'), ('Fee', 'None'), ('Gets', 'Dollars, or rupees when you send it on')])
            + '<p class="t13 mut" style="margin:14px 0 0">The secret part of this link stays in your browser. Plans never sees it.</p></div>')
    right = ('<div style="width:480px"><h1 class="d44">Claim it in a minute</h1><div class="col mt20" style="gap:16px">'
             '<div class="step"><span class="n">1</span><div class="t17">Create your Plans account with a passkey. No password, no bank details.</div></div>'
             '<div class="step"><span class="n">2</span><div class="t17">The money lands straight away.</div></div>'
             '<div class="step"><span class="n">3</span><div class="t17">Keep it as dollars, or send it on to anyone.</div></div></div>'
             '<div class="mt24" style="width:400px">' + btn('Create account &amp; claim', 'pri', 'key', 'lg') + btn('I already use Plans', 'sec', cls='lg mt8') + '</div>'
             '<p class="t13 mut" style="margin:14px 0 0">Works right here in your browser. On Android you can get the app later; your account comes with you.</p></div>')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{site_top()}'
            f'<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:96px;padding:0 48px">{left}{right}</div>{site_facts()}</div>')


def site_facts():
    facts = [('zap', 'Free and instant', 'Money between people on Plans arrives in under a second, with no fee.'),
             ('fp', 'Your fingerprint is your key', 'No password to forget. Your passkey lives in your phone or browser.'),
             ('globe', 'Friends in any country', 'Everyone sees amounts in their own money: pounds, dollars, rupees, euros.')]
    return ('<div class="g3c" style="padding:0 48px 32px;gap:16px">'
            + ''.join(f'<div class="mc row" style="align-items:flex-start">{tile(i)}<div class="lm"><div class="lt">{t}</div><div class="t13 mut">{d}</div></div></div>' for i, t, d in facts)
            + '</div>')


item('A', '116', 'Claim a link (web)',
     'What Asha sees opening Maya\'s money link on her laptop: who sent it, how much in her money, and one button. She can claim without installing anything.',
     'plans.0xo.in/c/9rk4#… opened in any desktop browser.',
     'Create account &amp; claim → browser passkey (103/105) → name and country → money lands → 108 with a “+$25.00 from Maya” toast. I already use Plans → 106 → claimed.',
     'Expired: “This link ran out. The money went back to Maya.” Already claimed: “Someone already claimed this.” Neither shows an amount. Missing secret: 124\'s copy.',
     'lap', lambda t: lap(t, 'plans.0xo.in/c/9rk4#•••••••••', claim_body()))

# ------------------------------------------------------------------ 117 Activity
def act_main():
    sel = ' style="box-shadow:0 0 0 2px var(--ink)"'
    return ('<div class="mh"><h1 class="d44">Activity</h1>' + f'<div class="row" style="gap:8px">{chip("All", "on")}{chip("Needs you · 2")}{chip("Money")}{chip("Plans")}</div></div>'
            '<div class="ov mt20">Needs you</div><div class="g2c mt8">'
            f'<div class="card"{sel}><div class="row" style="align-items:flex-start">{av("asha", 40)}<div class="lm"><div class="lt">Asha wants $250 for the boat trip</div>'
            '<div class="t13 mut">Lisbon · Ben said OK · 22 h left</div></div></div><div class="t13 b mt8 inf">Open in the panel →</div></div>'
            f'<div class="card"><div class="row" style="align-items:flex-start">{av("ben", 40)}<div class="lm"><div class="lt">Ben suggests a rule change</div>'
            '<div class="t13 mut">Lisbon · Food budget $120 → $180</div></div></div><div class="t13 b mt8">Vote →</div></div></div>'
            '<div class="ov mt20">Today</div>'
            + li(tile('out'), 'You sent £1.50 to Sam', 'Sam got $2.02', '−£1.50', '14:05')
            + li(av('sam', 40), 'Sam paid $36 · Dinner at Taberna', 'Lisbon · your share £8.91', '', '13:58')
            + li(tile('in', 'p'), 'You added £20 to Lisbon', 'The pot got $26.94', '', '09:12')
            + '<div class="ov mt16">Earlier</div>'
            + li(av('ben', 40), 'Ben paid $240 · Villa deposit', 'Lisbon · Sam and Asha said OK', '', 'Mon')
            + li(av('asha', 40), 'Asha joined Lisbon', 'Bengaluru 🇮🇳 · added $200.00', '', 'Mon')
            + li(tile('in', 'p'), 'Ben sent you $12.00', 'You got £8.91', '<span class="pos">+£8.91</span>', 'Sun')
            + li(emo('🎪', W['orchid'], 40), 'Glastonbury crew is settled', '<span class="neg b">You owe Ben £8.91 · Pay now</span>', '', '28 Jun'))


item('A', '117', 'Activity',
     'Everything that happened, with what needs you pinned on top. Picking a row opens its detail in the panel instead of leaving the list.',
     'Activity in the rail (red count when something needs you).',
     'Row → detail in the panel (29, 47, 40, 42 content). Approve/Reject in the panel → 111\'s flow.',
     'Empty: “All quiet. Spends, money in and settle-ups show up here.” Filters keep their own empty states. Selected row has an ink outline.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/activity', shell('act', act_main(), request_side())))

# ------------------------------------------------------------------ 118 You
def you_main():
    rows = [('globe', 'Country &amp; money', 'United Kingdom · £ GBP', ''), ('ticket', 'Your Plans account', '$5.00 · £3.71', ''),
            ('bell', 'Notifications', 'Browser notifications on · approvals, money in, settle-ups', ''),
            ('key', 'Devices with your passkey', 'Pixel 8 · MacBook Air (this browser)', ''),
            ('shield', 'What could go wrong', 'Lost phone, someone who won\'t pay, outages, freezes', 'i'),
            ('gift', 'Get test dollars', 'Test version only', 'a'), ('help', 'Help', '', ''), ('info', 'About Plans', 'Version 1.0 · Test version', '')]
    lst = ''.join(li(tile(i, c), t, s, ic('chev', 20)) for i, t, s, c in rows)
    return ('<div class="mh"><div class="row" style="gap:18px">' + av('maya', 72) + '<div><h1 class="d44">Maya</h1><div class="t15 mut">London, United Kingdom · shows £ GBP</div></div></div>'
            + btn('Edit profile', 'sec', 'edit', 'sm') + '</div>'
            '<div class="g2c mt20" style="grid-template-columns:1fr 1.25fr;align-items:start">'
            '<div class="mc c" style="padding:22px"><div class="ov">Your key fingerprint</div>'
            '<div class="mt12" style="display:inline-flex;gap:14px;padding:12px 22px;border-radius:999px;background:var(--surface-2);font-size:40px;line-height:1">🦊<span>🌵</span>🎈</div>'
            '<p class="t13 mut" style="margin:12px 0 0">The same on every device you use Plans on. Friends see these three next to your name.</p>'
            '<div class="hr"></div><div class="ov" style="text-align:left">Devices with your passkey</div>'
            + li(tile('phone'), 'Pixel 8', 'Google Password Manager', '<span class="t13 mut">Remove</span>')
            + li(tile('monitor'), 'MacBook Air', 'This browser · iCloud Keychain', '<span class="chip sm pos">This one</span>')
            + '<div class="t13 b mt8" style="text-align:left">+ Save a passkey on another device</div></div>'
            f'<div class="mc" style="padding:4px 16px">{lst}' + li(tile('logout', 'n'), '<span class="neg">Sign out of this browser</span>', '') + '</div></div>')


def you_side():
    def why(icon, t):
        return f'<div class="row" style="align-items:flex-start;gap:12px"><span class="tl" style="width:36px;height:36px">{ic(icon, 18)}</span><p class="t13" style="margin:2px 0 0;font-size:14px">{t}</p></div>'
    return ('<div class="d22">Your key</div><div class="col mt12" style="gap:14px">'
            + why('lock', 'Receipt photos and notes are scrambled before they leave this computer. Only people in that plan can open them.')
            + why('key', 'Your key comes from your passkey, so this browser and your phone have the same one.')
            + why('eye', 'Plans can\'t see your photos or notes. Neither can anyone outside the plan.')
            + why('users', 'If a friend\'s three pictures change and they didn\'t get a new device, ask them before approving anything.')
            + '</div>'
            + f'<div class="card t mt20"><div class="ov">How friends see you</div><div class="row mt8">{av("maya", 36)}<span class="lt lm">Maya</span><span class="pill" style="font-size:15px;letter-spacing:3px">🦊🌵🎈</span></div></div>'
            + '<div class="sp"></div>'
            '<div class="card t"><div class="row">' + tile('monitor', 'a') + '<div class="lm"><div class="lt">Install Plans on this computer</div><div class="t13 mut">Opens in its own window, like an app.</div></div></div>'
            + btn('Install', 'sec', 'download', 'sm mt12') + '</div>')


item('A', '118', 'You and your key',
     'Profile, key fingerprint, settings. Kept as short as the phone. No diagnostics or developer panels on the web; problems go through Help with a reference.',
     'You in the rail; the name and pictures at the bottom of the rail.',
     'What could go wrong → 148. Devices with your passkey → list with “Remove”. Sign out → confirm: “Receipts reopen when you come back with the same passkey.”',
     'If the passkey lives only on a phone (104), Devices shows “This browser uses your phone” with “Save a passkey here too”. Install appears only where the browser supports it.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/you', shell('you', you_main(), you_side())))

# ------------------------------------------------------------------ 119–121 phone browsers
from s1 import ILLO  # noqa: E402


def WELCOME2(illo_h=350, banner='', create=None, foot=True):
    c = create if create is not None else btn('Create account', 'pri', 'fp')
    f = '<p class="t13 mut c" style="margin:12px 0 0">No passwords. Your fingerprint is your key.</p>' if foot else ''
    return (f'<div class="row" style="height:52px">{logo(22)}</div>'
            + ILLO.replace('class="illo"', f'class="illo" style="height:{illo_h}px"')
            + '<h1 class="d34" style="font-size:38px">One pot for the<br>whole plan.</h1>'
            + '<p class="t17 mut mt12" style="margin-bottom:0">Friends anywhere chip in, spend under rules you agree, and settle up in one tap.</p>'
            + '<div class="sp"></div>' + banner + c
            + btn('I already use Plans', 'sec', cls='mt8') + f)


def pbud():
    return (f'<div class="card mt16" style="--plan:{LIS}"><div class="row sbw"><span class="d17">Budgets</span><span class="t13 mut row" style="gap:2px">Rules{ic("chev", 16)}</span></div>'
            + ''.join(f'<div class="mt12">{bud(*b)}</div>' for b in BUDS) + '</div>')


def pmembers():
    data = [('maya', 'You', '+£18.00', 'pos'), ('sam', 'Sam', 'All square', 'mut'), ('asha', 'Asha', '−₹676', 'neg'), ('ben', 'Ben', '−£12.00', 'neg')]
    cells = ''.join(f'<div class="c" style="width:68px">{av(k, 44, ring=(k == "maya"))}<div class="t13 b mt8">{n}</div><div class="t11 b {c}">{v}</div></div>' for k, n, v, c in data)
    return f'<div class="row mt16" style="justify-content:space-between;gap:0">{cells}</div>'


def pplan():
    return (ab('🌊 Lisbon, 12–16 Oct', right=ib('users') + ib('more')) + '<div class="bleed">' + wb(LIS, 'Day 2 of 5 · 4 people · 3 countries') + '</div>'
            + '<div class="card mt12"><div class="row sbw"><span class="ov">In the pot</span><span class="t13 mut">4 put in $800.00</span></div>'
              '<div class="hero mt4"><span class="d34">$446.00</span><span class="t17 m2">£331.06</span></div>'
              f'<div class="row sbw mt12"><span class="chip sm pos">You\'re owed £18.00</span><span class="t13 b row" style="gap:2px">Why{ic("chev", 16, 2.2)}</span></div></div>'
            + pmembers() + pbud()
            + f'<div class="sec-h"><span class="d17 row" style="gap:10px"><span class="dot"></span>Live</span><a>All spends</a></div>'
            + li(av('sam', 36), 'Sam paid $36.00 · Dinner', 'Food &amp; drink · your share £8.91', '', '2 min'))


item('A', '119', 'Phone browser: Welcome in Android Chrome',
     'Parity check. In a phone browser the web app is the approved phone layout, with Chrome\'s bar on top. This is Welcome after fixes 125 (no language pill).',
     'plans.0xo.in/app on a phone.',
     'Same as 01/125. Create account → Android\'s own passkey sheet (02), because Chrome uses Google Password Manager.',
     'Chrome\'s bar takes 56 px; the illustration keeps its full height and the buttons still sit above the fold on a 390 × 844 phone.',
     'phone', lambda t: mphone(t, WELCOME2(), url='plans.0xo.in/app'))

item('A', '120', 'Phone browser: Plan home in iPhone Safari',
     'Parity check on iPhone, where there\'s no Android app: the same plan home as 16, with the tab bar above Safari\'s toolbar.',
     'plans.0xo.in/app/plan/7kq2 in Safari, or from the Home Screen once added.',
     'Same as 16.',
     'Added to the Home Screen it runs without Safari\'s bars and looks like the Android app. Passkeys use iCloud Keychain.',
     'phone', lambda t: mphone(t, pplan(), h=900, kind='safari', url='plans.0xo.in', tab='plans'))


def send_phone():
    return (ab('Send to Sam', sub='New York · gets dollars', right=f'<span style="margin-right:8px">{av("sam", 36)}</span>')
            + '<div class="c mt16"><div class="d56">£1.50<span style="display:inline-block;width:3px;height:48px;background:var(--accent);vertical-align:-6px;margin-left:2px"></span></div>'
              f'<div class="mt8" style="font-size:21px">Sam gets <b>$2.02</b></div><div class="mt8">{RATE}</div>'
              f'<span class="chip sm ol mt12">{ic("swap", 14, 2)}Type in dollars</span></div>'
            + '<div class="card t mt20"><div class="row sbw"><div><div class="t13 mut">You have</div><div class="b">$5.00 · £3.71</div></div>' + AUSD + '</div></div>'
            + '<div class="sp"></div>' + kp() + btn('Continue', cls='mt8'))


INSTALL = ('<div style="position:absolute;left:0;right:0;bottom:22px;z-index:35;background:var(--surface);border-top:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:12px;box-shadow:var(--shadow)">'
           '<span class="fav" style="width:36px;height:36px;border-radius:9px"></span><div class="lm"><div class="lt">Add Plans to Home screen</div><div class="t13 mut">plans.0xo.in</div></div>'
           '<span class="t15 b" style="color:var(--sys-pri)">Install</span></div>')

item('A', '121', 'Phone browser: Send in Android Chrome',
     'Parity check for money: Send works in the browser exactly like 45, including the app\'s own number pad, and Chrome offers to install it.',
     'plans.0xo.in/app/send on a phone.',
     'Same as 45 → 46 → 47. Install → Plans opens in its own window next time.',
     'Chrome shows its install bar once; dismissing it is remembered by the browser, not by Plans.',
     'phone', lambda t: mphone(t, send_phone(), h=900, url='plans.0xo.in/app/send', over=INSTALL))
