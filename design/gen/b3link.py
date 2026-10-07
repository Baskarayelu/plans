"""Design addendum: bring an existing Plans account into a browser that uses another password manager.
Items 165+. Imports the Build 2 helpers unchanged (b2core, b2a, s1); registers into its own ITEMS3/SECTIONS3
so build2's output is untouched. Run via build3.py."""
from b2core import *  # noqa: F401,F403  (base helpers, lap(), mphone(), aphone(), chrome dialogs)
import b2a
from b2a import WELCOME_ILLO, WELCOME2

ITEMS3 = []
SECTIONS3 = []

# The three pictures for a link code. Deliberately NOT Maya's key fingerprint (🦊🌵🎈), so the two never get confused.
CHK = ['🐙', '🍋', '🚲']
CODE = 'K7Q2-9RXD-M4TA'
DEV = 'Chrome on a Mac'


def section3(k, name, desc, note=''):
    SECTIONS3.append(dict(k=k, name=name, desc=desc, note=note))


def item3(sec, n, title, purpose, entry, exit_, states, kind, frame, labels=None):
    """kind: 'phone' | 'lap' | 'both' (frame=(lap_fn, phone_fn)) | 'phones' / 'laps' (frame returns a list; labels names each state)."""
    ITEMS3.append(dict(sec=sec, n=n, title=title, purpose=purpose, entry=entry, exit=exit_, states=states,
                       kind=kind, frame=frame, labels=labels))


def at(h, t='14:24'):
    """Phone status-bar clock to match the code's 14:22 → 14:32 window."""
    return h.replace('<span>14:05</span>', f'<span>{t}</span>', 1)


def ap(theme, body, **kw):
    return at(aphone(theme, body, **kw))


def sp(theme, inner, h=900, url='plans.0xo.in/app', over=''):
    """The web app in iPhone Safari: the cross-password-manager case on a phone."""
    return at(mphone(theme, inner, h=h, kind='safari', url=url, over=over))


# ------------------------------------------------------------------ small components
def lsteps(n):
    return '<span class="lsteps">' + ''.join(f'<i{" class=on" if i <= n else ""}></i>' for i in (1, 2, 3)) + '</span>'


def steplabel(n):
    return f'<span class="row t13 b mut" style="gap:10px">Link this browser · step {n} of 3{lsteps(n)}</span>'


def code(size=30):
    a, b, c = CODE.split('-')
    return f'<span class="lcode" style="font-size:{size}px">{a}<i>-</i>{b}<i>-</i>{c}</span>'


def emo3(size=36, cls=''):
    return f'<span class="emo3 {cls}" style="font-size:{size}px">' + ''.join(f'<span>{e}</span>' for e in CHK) + '</span>'


def opt(icon, title, sub, tcls='', cls=''):
    return (f'<div class="opt {cls}">{tile(icon, tcls)}<div class="lm"><div class="lt">{title}</div>'
            f'<div class="t13 mut mt4">{sub}</div></div><span class="mut">{ic("chev", 20, 2)}</span></div>')


def wait_line(big=False):
    s = ' style="padding:14px 18px"' if big else ''
    return (f'<div class="waitl"{s}>{ic("phone", 22, 1.8)}<div class="lm"><div class="b">Waiting for your phone…</div>'
            '<div class="t13 mut">Expires at 14:32 · one use only</div></div></div>')


def never_two(cls=''):
    return f'<div class="row t13 {cls}" style="gap:8px;align-items:flex-start">{ic("shieldok", 18, 2)}<span><b>Plans never makes a second account without asking.</b></span></div>'


def why_row(icon, title, text):
    return (f'<div class="row" style="align-items:flex-start;gap:14px"><span class="tl">{ic(icon, 20)}</span>'
            f'<div><div class="lt">{title}</div><div class="t13 mut mt4" style="font-size:14px">{text}</div></div></div>')


def qrbox(px=200, seed='link-k7q2', dim=False):
    d = ' dim' if dim else ''
    return f'<div class="qrpad{d}">{qr(seed, px, center=QR_LOGO)}</div>'


QR_LOGO = '<span class="logo" style="font-size:13px"><span class="lb"></span></span>'


def rpanel(inner, step=None, pad='48px 88px 36px'):
    s = steplabel(step) if step else '<span class="t13 b mut">What is Plans?</span>'
    return (f'<div style="flex:1;display:flex;flex-direction:column;padding:{pad};min-width:0">'
            f'<div class="row sbw">{logo(26)}{s}</div>{inner}</div>')


def split(inner, step=None, pad='48px 88px 36px'):
    return WELCOME_ILLO + rpanel(inner, step, pad)


def webtop(step=None):
    s = f'<span class="t13 b mut row" style="gap:8px">{step} of 3{lsteps(step)}</span>' if step else ''
    return f'<div class="webtop">{logo(20)}{s}</div>'


# ------------------------------------------------------------------ browser dialogs (drawn generically)
def chrome_none():
    """Chrome's 'get' dialog when this browser has no passkey for the site."""
    return ('<div class="cdlg">'
            f'<div class="cdh">{ic("key", 22, 1.8)}</div>'
            '<div class="cdt">Use a passkey for plans.0xo.in</div>'
            '<p class="cdp">There are no passkeys for plans.0xo.in saved on this computer.</p>'
            f'<div class="cdl">{ic("phone", 18, 1.8)}Use a phone or tablet</div>'
            '<div class="cdb"><span class="sp"></span><span class="cbt o">Cancel</span></div></div>')


def chrome_hybrid_get():
    return ('<div class="cdlg">'
            f'<div class="cdh">{ic("phone", 22, 1.8)}</div>'
            '<div class="cdt">Use a passkey from a phone or tablet</div>'
            '<p class="cdp">Scan this QR code with the camera on the phone or tablet that has your passkey for plans.0xo.in.</p>'
            f'<div class="c" style="margin:6px 0 14px"><div style="display:inline-block;padding:8px;background:#fff;border-radius:12px">{qr("cqr-get", 168)}</div></div>'
            f'<p class="cdp row" style="gap:8px;align-items:flex-start">{ic("bt", 16, 2)}<span>Both devices need Bluetooth on and must be near each other.</span></p>'
            '<div class="cdb"><span class="cbt o">Back</span><span class="sp"></span><span class="cbt o">Cancel</span></div></div>')


def ios_none():
    return ('<div class="ios-scrim"></div><div class="ios">'
            f'<div class="ik">{ic("person-key", 26, 1.7)}</div>'
            '<div class="it">Use a passkey for “plans.0xo.in”?</div>'
            '<p>No passkeys for this website are saved on this iPhone.</p>'
            f'<div class="iopt">{ic("phone", 18, 2)}Use a passkey from a nearby device</div>'
            '<div class="iopt mt8 can">Cancel</div></div>')


# ------------------------------------------------------------------ 165 Create account looks first
LOOKING = (f'<div class="row t15 mut" style="gap:10px;margin-bottom:14px">{ic("search", 20, 2)}'
           '<span>Looking for a Plans passkey in this browser first, so you don\'t end up with two accounts.</span></div>')


def s165_lap(t):
    body = b2a.welcome_body(LOOKING, btn('Create account', 'off', 'key', 'lg')).replace(
        btn('I already use Plans', 'sec', cls='lg mt8'), btn('I already use Plans', 'off', cls='lg mt8'))
    return lap(t, 'plans.0xo.in/app', body, over=chrome_none())


def s165_ph(t):
    inner = WELCOME2(illo_h=280, create=btn('Create account', 'off', 'fp'), foot=False).replace(
        btn('I already use Plans', 'sec', cls='mt8'), btn('I already use Plans', 'off', cls='mt8'))
    return sp(t, inner, h=844, over=ios_none())


# ------------------------------------------------------------------ 166 the choice
OPT1 = ('qr', 'Use your phone\'s passkey', 'Your browser shows a code; scan it with your phone.')
OPT2 = ('link', 'Link this browser to your account', 'For when your phone\'s passkey can\'t be used here. Takes a minute.')
OPT3 = ('plus', 'I\'m new to Plans', 'Make a new account with a passkey saved in this browser.')


def choice_inner(banner='', hi=0, ph=False):
    h = '<h1 class="d34" style="font-size:32px">Use Plans on another phone already?</h1>' if ph else '<h1 class="d44">Use Plans on your phone already?</h1>'
    lede = ('This browser has no Plans passkey. If your account is on ' + ('another phone' if ph else 'your phone') + ', bring it here instead of starting again.')
    opts = [opt(OPT1[0], OPT1[1], OPT1[2], 'a', 'hi' if hi == 1 else ''),
            opt(OPT2[0], OPT2[1], OPT2[2], 'a', 'hi' if hi == 2 else ''),
            opt(OPT3[0], OPT3[1], OPT3[2], '', 'hi' if hi == 3 else '')]
    gap = '10px' if ph else '12px'
    return (h + f'<p class="t17 mut" style="margin:{"10px 0 18px" if ph else "12px 0 24px"};max-width:540px">{lede}</p>'
            + banner + f'<div class="col" style="gap:{gap}">' + ''.join(opts) + '</div>'
            + never_two('mt20'))


def s166_lap(t, banner='', hi=0, over=''):
    inner = '<div class="sp"></div>' + choice_inner(banner, hi) + '<div class="sp"></div>' + f'<span class="t15 b mut">{ic("back", 16, 2.2)} Back</span>'
    return lap(t, 'plans.0xo.in/app', split(inner), over=over)


def s166_ph(t, banner='', hi=0):
    return sp(t, webtop() + '<div class="mt8"></div>' + choice_inner(banner, hi, ph=True), h=900)


# ------------------------------------------------------------------ 168 step 1
def step1_inner(ph=False):
    h = 'd34' if ph else 'd44'
    o = 'other phone' if ph else 'phone'
    rows = (why_row('key', 'A new passkey, just for this browser', 'Saved where this browser keeps its passkeys. The passkey on your other phone stays there.' if ph else 'Saved where this browser keeps its passkeys. Your phone\'s passkey stays on your phone.')
            + why_row('phone', f'Your {o} says yes', f'Next you\'ll open Plans on your {o} and scan a code. Nothing is shared until you confirm there.')
            + why_row('user', 'Still one account', 'Same plans, same money, same key fingerprint. Nothing new is made.'))
    b = btn('Save a passkey here', 'pri', 'fp' if ph else 'key', '' if ph else 'lg')
    return (f'<h1 class="{h}">Save a passkey for this browser</h1>'
            f'<p class="t17 mut" style="margin:12px 0 22px;max-width:540px">This browser gets its own passkey. Your account stays the same.</p>'
            f'<div class="col" style="gap:18px;max-width:560px">{rows}</div>'
            + ('<div class="sp"></div>' if ph else '<div class="mt32"></div>')
            + f'<div style="{"" if ph else "width:400px"}">{b}' + btn('Back', 'txt', cls='mt4') + '</div>')


def s168_lap(t):
    return lap(t, 'plans.0xo.in/app/link', split('<div class="sp"></div>' + step1_inner() + '<div class="sp"></div>', step=1))


def s168_ph(t):
    return sp(t, webtop(1) + '<div class="mt16"></div>' + step1_inner(ph=True), h=900, url='plans.0xo.in/app/link')


# ------------------------------------------------------------------ 169 step 2
def howto(ph=False):
    st = [(f'On your {"other " if ph else ""}phone: <b>You → Add a browser</b>', ''),
          ('Scan this code, or type it in', ''),
          ('Check the three pictures match, then confirm with your fingerprint', '')]
    return '<div class="col8">' + ''.join(f'<div class="step"><span class="n">{i + 1}</span><span class="t15">{a}</span></div>' for i, (a, _) in enumerate(st)) + '</div>'


def step2_inner(state='wait', ph=False):
    dim = state == 'expired'
    banner = ''
    if state == 'expired':
        banner = bn('neg', 'clock', 'This code ran out', 'Codes work for 10 minutes. Make a new one, then scan it with your phone.') + '<div class="mt16"></div>'
    elif state == 'net':
        banner = bn('neg', 'wifioff', 'Can\'t reach Plans right now', 'Your phone can still scan this code. Check this computer\'s connection, then try again. The code works until 14:32.') + '<div class="mt16"></div>'
    pics = (f'<div class="ov">Check these match on your {"other " if ph else ""}phone</div><div class="mt8">{emo3(30 if ph else 36)}</div>')
    codeblk = f'<div class="ov">Or type this code</div><div class="mt8">{code(24 if ph else 30)}</div>'
    if ph:
        top = (f'<div class="c">{qrbox(200, dim=dim)}</div>'
               f'<div class="c mt16{" dim" if dim else ""}">{codeblk}</div>'
               f'<div class="c mt16{" dim" if dim else ""}">{pics}</div>')
    else:
        top = (f'<div class="row" style="gap:32px;align-items:center">{qrbox(208, dim=dim)}'
               f'<div class="{"dim" if dim else ""}">{codeblk}<div class="mt20"></div>{pics}</div></div>')
    if state == 'expired':
        foot = '<div style="width:400px">' + btn('Make a new code', 'pri', 'refresh', 'lg') + '</div>' if not ph else btn('Make a new code', 'pri', 'refresh')
    elif state == 'net':
        foot = ('<div class="btns" style="width:520px">' + btn('Try again', 'pri', 'refresh', 'lg') + btn('Cancel', 'sec', cls='lg') + '</div>') if not ph else btn('Try again', 'pri', 'refresh')
    else:
        foot = wait_line(not ph) + f'<div class="{"c " if ph else ""}mt12"><span class="t15 b" style="text-decoration:underline;text-underline-offset:4px">Cancel</span></div>'
    h = 'd28' if ph else 'd44'
    return (f'<h1 class="{h}">Open Plans on your {"other " if ph else ""}phone</h1>'
            + ('<div class="mt16"></div>' if ph else '<p class="t17 mut" style="margin:10px 0 22px">Your phone confirms it\'s you. Then this browser can use your account.</p>')
            + banner + top
            + (f'<div class="mt20">{howto(ph)}</div>' if state == 'wait' else '')
            + ('<div class="sp"></div>' if ph else '<div class="mt24"></div>') + foot)


def s169_lap(t, state='wait'):
    return lap(t, 'plans.0xo.in/app/link', split('<div class="sp"></div>' + step2_inner(state) + '<div class="sp"></div>', step=2, pad='40px 80px 32px'))


def s169_ph(t):
    return sp(t, webtop(2) + '<div class="mt8"></div>' + step2_inner(ph=True), h=1010, url='plans.0xo.in/app/link')


# ------------------------------------------------------------------ 170 step 3
def linked_card(ph=False):
    plans = (li(emo('🌊', W['lagoon'], 40), 'Lisbon, 12–16 Oct', 'Active · 4 people', '<span class="pos">+£18.00</span>', 'owed to you')
             + li(emo('🎪', W['orchid'], 40), 'Glastonbury crew', 'Ended · 5 people', '<span class="neg">−£8.91</span>', 'you owe'))
    who = (f'<div class="row mt16">{av("maya", 52)}<div class="lm"><div class="d22">Maya</div><div class="t13 mut">London · £ GBP</div></div></div>'
           f'<div class="row mt12" style="gap:12px;flex-wrap:wrap">{fp("Your key")}<span class="chip sm pos">{ic("check", 14, 2.6)}Same as on your {"other " if ph else ""}phone</span></div>')
    return (f'<div class="bigic p" style="margin:0">{ic("check", 36, 2.4)}</div>'
            f'<h2 class="{"d28" if ph else "d34"} mt16">This browser is linked</h2>'
            + who
            + '<div class="mt12">' + plans + '</div>'
            + f'<div class="card t mt12" style="padding:12px 14px"><div class="row" style="align-items:flex-start;gap:10px">{ic("key", 18, 2)}'
              f'<span class="t13" style="font-size:14px">Next time, just use the passkey saved here. You won\'t need your {"other " if ph else ""}phone.</span></div></div>')


def s170_lap(t):
    card = f'<div class="mc" style="width:560px;padding:32px">{linked_card()}<div class="mt20" style="width:240px">' + btn('Go to my plans', 'pri') + '</div></div>'
    return lap(t, 'plans.0xo.in/app/link', WELCOME_ILLO + f'<div style="flex:1;display:grid;place-items:center">{card}</div>')


def s170_ph(t):
    return sp(t, webtop(3) + '<div class="mt12"></div>' + linked_card(ph=True) + '<div class="sp"></div>' + btn('Go to my plans', 'pri'), h=900, url='plans.0xo.in/app/link')


# ------------------------------------------------------------------ 171 phone You
def you_phone():
    new = '<span class="row" style="gap:6px"><span class="chip sm acc">New</span>' + ic('chev', 20) + '</span>'
    return (f'<div class="c mt16"><div style="display:inline-block">{av("maya", 80)}</div><h2 class="d28 mt12">Maya</h2>'
            '<div class="t13 mut">London, United Kingdom · shows £ GBP</div></div>'
            + f'<div class="card mt16"><div class="row sbw">{fp()}{ic("chev", 20)}</div><p class="t13 mut" style="margin:8px 0 0">Your key fingerprint. The same on every device that uses your account.</p></div>'
            + '<div class="mt8">'
            + li(tile('globe'), 'Country &amp; money', 'United Kingdom · £ GBP', ic('chev', 20))
            + li(tile('ticket'), 'Your Plans account', '$5.00 · £3.71', ic('chev', 20))
            + li(tile('bell'), 'Notifications', 'Approvals, money in, settle-ups', ic('chev', 20))
            + li(tile('phone'), 'Phones and browsers', 'Pixel 8 (this one) · Galaxy Tab', ic('chev', 20))
            + li(tile('monitor', 'a'), 'Add a browser', 'Use Plans on a computer with your account', new, cls='addb')
            + li(tile('gift', 'a'), 'Get test dollars', 'Test version only', ic('chev', 20))
            + li(tile('help'), 'Help', '', ic('chev', 20))
            + li(tile('info'), 'About Plans', 'Version 1.0 · Test version', ic('chev', 20))
            + li(tile('logout', 'n'), '<span class="neg">Sign out</span>', '')
            + '</div>')


# ------------------------------------------------------------------ 172 scan / type
SCAN_CORN = ''.join(f'<span class="vfc" style="{s}"></span>' for s in [
    'left:75px;top:200px;border-right:0;border-bottom:0;border-radius:18px 0 0 0',
    'right:75px;top:200px;border-left:0;border-bottom:0;border-radius:0 18px 0 0',
    'left:75px;top:440px;border-right:0;border-top:0;border-radius:0 0 0 18px',
    'right:75px;top:440px;border-left:0;border-top:0;border-radius:0 0 18px 0'])


def scanner():
    screen = ('<div class="lscreen"><div class="lsbar"></div>'
              f'<div style="display:grid;place-items:center;flex:1">{qr("link-k7q2", 150, center=QR_LOGO)}</div></div>')
    return ('<div style="position:absolute;inset:0;overflow:hidden"><div class="vf"></div>' + screen + SCAN_CORN
            + '<div style="position:absolute;left:0;right:0;top:38px;padding:0 8px;color:#fff">'
            + f'<div class="ab" style="margin:0"><span class="ib" style="color:#fff">{ic("x")}</span><h1 style="color:#fff">Add a browser</h1><span class="ib" style="color:#fff">{ic("torch")}</span></div></div>'
            + '<div class="c" style="position:absolute;left:24px;right:24px;top:510px;color:#fff">'
            + '<div class="b t17">Point at the code on the computer\'s screen</div>'
            + '<p class="t13" style="margin:8px 0 0;opacity:.78">On the computer, open plans.0xo.in/app and choose “Link this browser to your account”.</p>'
            + f'<p class="t13 row" style="margin:14px 0 0;opacity:.78;justify-content:center;gap:6px;align-items:flex-start;text-align:left">{ic("shield", 16, 2)}<span>Only scan a code on a computer you\'re using right now.</span></p></div>'
            + '<div style="position:absolute;left:16px;right:16px;bottom:30px">'
            + '<span class="btn" style="background:rgba(255,255,255,.14);color:#fff">' + ic('edit', 22, 2) + 'Type the code instead</span></div></div>')


def type_code(err=False):
    val = 'K7Q2-9RXD-M4<span class="caret"></span><span class="mut">XX</span>' if not err else 'K7Q2-9RXD-M4TB'
    fl = 'err' if err else 'on'
    msg = ('<div class="row t13 neg mt8" style="gap:6px;align-items:flex-start">' + ic('alert', 16, 2.2)
           + '<span><b>That code doesn\'t match.</b> Check it against the computer\'s screen and try again.</span></div>') if err else \
        '<div class="t13 mut mt8">12 letters and numbers. Capitals or not, it doesn\'t matter. We add the dashes.</div>'
    return (ab('Type the code')
            + '<p class="t15 mut" style="margin:4px 0 16px">You\'ll find it on the computer, under the square code.</p>'
            + f'<div class="fld {fl}"><div><label>Code</label><div class="fv mono" style="font-size:22px;letter-spacing:.06em">{val}</div></div></div>'
            + msg
            + '<div class="card t mt16"><div class="t13 mut">Looks like</div><div class="mono b mt4" style="font-size:18px;letter-spacing:.06em">XXXX-XXXX-XXXX</div>'
              '<div class="t13 mut mt4">No O or I, so 0 and 1 are always numbers.</div></div>'
            + '<div class="sp"></div>' + btn('Continue', 'pri' if not err else 'off'))


# ------------------------------------------------------------------ 173 check pictures
def check_body(state='ok'):
    pics = f'<div class="c mt8"><div class="ov">Pictures for this link</div><div class="mt12">{emo3(52, "big")}</div></div>'
    q = ('<h2 class="d28 c mt20">Do these match the screen you\'re linking?</h2>'
         '<p class="t13 mut c" style="margin:8px 0 0">Same three, same order. If even one is different, it\'s not your computer.</p>')
    dev = ('<div class="card mt16" style="padding:4px 14px">'
           + li(tile('monitor'), DEV, 'Wants to use your account · code made at 14:22', '', cls='nb') + '</div>')
    expl = ('<p class="t13 mut" style="margin:12px 2px 0">If they match, your phone gives this browser what it needs to use your account. '
            'It gets its own passkey; yours stays on this phone.</p>')
    if state == 'net':
        tail = (bn('neg', 'wifioff', 'Couldn\'t reach Plans', 'Nothing was sent. Check your connection and try again. The code works until 14:32.')
                + '<div class="mt12"></div>' + btn('Try again', 'pri', 'refresh') + btn('Cancel', 'sec', cls='mt8'))
    else:
        tail = (btn('They match · Confirm with fingerprint', 'pri', 'fp', style='font-size:16px')
                + btn('They don\'t match', 'sec', cls='mt8'))
    return ab('Check the pictures', icon='x') + pics + q + dev + (expl if state != 'net' else '') + '<div class="sp"></div>' + tail


# ------------------------------------------------------------------ 174 sent
def sent_body():
    return ('<div class="sp"></div>'
            f'<div class="bigic p">{ic("check", 36, 2.4)}</div>'
            f'<h2 class="d28 c mt20">{DEV} can now use your account</h2>'
            '<p class="t17 mut c" style="margin:10px 6px 0">It has its own passkey. Your phone\'s passkey stays on your phone.</p>'
            '<div class="card mt24 col" style="gap:14px">'
            + why_row('users', 'Same account', 'Same plans, same money, same key fingerprint 🦊🌵🎈.')
            + why_row('phone', 'Listed under Phones and browsers', f'{DEV} · Linked · its own passkey. Remove it there any time.')
            + why_row('bell', 'We\'ll tell you', 'You get a notice here whenever a browser is added or removed.')
            + '</div><div class="sp"></div>' + btn('Done', 'pri'))


# ------------------------------------------------------------------ 175 phone errors
def err_body(icon, kind, title, text, extra='', btns=''):
    return ('<div class="sp"></div>' + f'<div class="bigic {kind}">{ic(icon, 34, 2.2)}</div>'
            + f'<h2 class="d28 c mt20">{title}</h2><p class="t17 mut c" style="margin:10px 6px 0">{text}</p>'
            + extra + '<div class="sp"></div>' + btns)


def err_mismatch():
    return (ab('', icon='x') + err_body('ban', 'n', 'Stop. Don\'t link it.', 'Nothing was sent. Make a new code on the computer and try again.',
            '<div class="mt20">' + bn('mut', 'shield', 'Didn\'t start this yourself?', 'Someone may have shown you their code. Your account hasn\'t changed and there\'s nothing else to do.') + '</div>',
            btn('Done', 'pri')))


def err_expired():
    return (ab('', icon='x') + err_body('clock', 'm', 'This code ran out', 'This code ran out. Make a new one on the computer.',
            '<p class="t13 mut c" style="margin:12px 0 0">Codes work for 10 minutes, once.</p>',
            btn('Scan a new code', 'pri', 'scan') + btn('Done', 'sec', cls='mt8')))


def err_used():
    return (ab('', icon='x') + err_body('link', 'm', 'This code was already used', 'Each code works once. Make a new one on the computer and scan that.',
            '<p class="t13 mut c" style="margin:12px 0 0">If you didn\'t use it, look in You → Phones and browsers for anything you don\'t recognise.</p>',
            btn('Scan a new code', 'pri', 'scan') + btn('Done', 'sec', cls='mt8')))


# ------------------------------------------------------------------ 177 unlock later
def unlock_right():
    inner = ('<div class="sp"></div>' + av('maya', 72)
             + '<h1 class="d56 mt20" style="font-size:60px">Welcome back, Maya</h1>'
             + '<p class="t17 mut" style="font-size:19px;margin:14px 0 26px;max-width:520px">Unlock Plans with the passkey saved in this browser.</p>'
             + '<div style="width:400px">' + btn('Unlock with passkey', 'pri', 'key', 'lg') + btn('Use another account', 'sec', cls='lg mt8') + '</div>'
             + f'<div class="row t13 mut mt16" style="gap:8px">{ic("link", 16, 2)}<span>This browser is linked to your account · its own passkey</span></div>'
             + '<div class="sp"></div>'
             + f'<div class="row t13 mut" style="gap:10px">{fp("Your key")}<span>Check these match your phone if you ever need to.</span></div>')
    return rpanel(inner)


# ------------------------------------------------------------------ 178 laptop You with linked browser
def you_main_linked():
    h = b2a.you_main()
    reps = [
        ('Pixel 8 · MacBook Air (this browser)', 'Pixel 8 · Chrome on a Mac (this browser, linked)'),
        (li(tile('phone'), 'Pixel 8', 'Google Password Manager', '<span class="t13 mut">Remove</span>'),
         li(tile('phone'), 'Pixel 8', 'Your phone · Google Password Manager', '<span class="t13 mut">Remove</span>')),
        (li(tile('monitor'), 'MacBook Air', 'This browser · iCloud Keychain', '<span class="chip sm pos">This one</span>'),
         li(tile('monitor'), DEV, '<span class="pos b">This browser</span> · Linked · its own passkey',
            '<span class="t13 b neg">Remove</span>', cls='rmsel')),
        ('+ Save a passkey on another device', '+ Link another browser'),
    ]
    for a, b in reps:
        assert a in h, a
        h = h.replace(a, b)
    return h


def you_side_linked():
    h = b2a.you_side()
    a = 'Your key comes from your passkey, so this browser and your phone have the same one.'
    assert a in h
    return h.replace(a, 'Your phone gave this browser your key when you linked it, so receipts and notes open here too.')


REMOVE = ('<div class="panel-x">'
          f'<div class="row sbw"><span class="ov">Devices with your passkey</span><span class="ib" style="width:36px;height:36px">{ic("x", 20)}</span></div>'
          f'<div class="bigic n mt16" style="margin-left:0;width:56px;height:56px">{ic("monitor", 26, 2)}</div>'
          '<h2 class="d28 mt16">Remove this browser?</h2>'
          f'<div class="card t mt12" style="padding:4px 14px">' + li(tile('monitor'), DEV, 'Linked 7 Oct · its own passkey', '', cls='nb') + '</div>'
          '<p class="t15" style="margin:10px 0 0">Only this browser stops using your account. Your phone, your plans and your money don\'t change.</p>'
          '<p class="t13 mut" style="margin:8px 0 0">The passkey saved here stops working for Plans. To use Plans here again, link it again from your phone.</p>'
          '<div class="sp"></div>'
          + btn('Remove · Confirm with passkey', 'dng', 'key') + btn('Cancel', 'sec', cls='mt8') + '</div>')


def s178(t):
    body = shell('you', you_main_linked(), you_side_linked() + REMOVE)
    return lap(t, 'plans.0xo.in/app/you', body)


# ================================================================== register
section3('W', 'Create account looks for your account first',
         'On the web, “Create account” never goes straight to a new passkey. The browser is asked for any Plans passkey first; if it finds none, the person chooses how to bring their account across, or says they\'re new.')

item3('W', '165', 'Create account: the browser looks for a passkey first',
      'Before making anything, Plans asks the browser for any passkey saved for plans.0xo.in. The browser\'s own dialog lists every one it can reach, plus “Use a phone or tablet”. Drawn here is the case that matters: none saved in this browser.',
      '102 → Create account (laptop); 119 → Create account (phone browser).',
      'A passkey is listed → fingerprint or screen lock → 107 Welcome back. No new account. Nothing found, Cancel, or the dialog closes → 166. “Use a phone or tablet” → 167.',
      'Browsers can\'t tell Plans “nothing found” apart from “Cancel”, so both go to 166. Both Welcome buttons are disabled while the dialog is open. On iPhone Safari the sheet is Apple\'s; same outcomes.',
      'both', (s165_lap, s165_ph))

item3('W', '166', 'Use Plans on your phone already?',
      'The fork that prevents a silent second account. Three plain choices: use the phone\'s passkey through the browser, link this browser, or start fresh. Only the third makes a new account.',
      '165 when the browser found no passkey or was closed.',
      'Use your phone\'s passkey → 167. Link this browser to your account → 168. I\'m new to Plans → the normal create dialog (103 Chrome, 105 Safari) → name, country, currency. Back → 102.',
      'If 167 fails because the browser can\'t use the phone\'s passkey properly, this screen comes back with a banner and option two outlined (176, first state).',
      'both', (s166_lap, s166_ph))

item3('W', '167', 'Use your phone\'s passkey: the browser\'s QR',
      'Chrome\'s own “Use a phone or tablet” dialog over the choice screen. The phone\'s camera scans it and the phone\'s passkey is used across Bluetooth. Plans draws none of this.',
      '166 → Use your phone\'s passkey (or “Use a phone or tablet” in 165).',
      'Phone confirms and the browser hands Plans what it needs → 107 Welcome back, “Same key as your phone”. The browser doesn\'t → 176 “Your phone\'s passkey couldn\'t be used here”. Back → 166. Cancel → 166.',
      'Laptop only: on an iPhone the same QR appears, but the person would need a second device to scan it, so 166 on phones suggests option two first. Every later visit asks for the phone again; 107 offers “Link this browser” so they don\'t have to.',
      'lap', lambda t: s166_lap(t, over=chrome_hybrid_get()))

section3('L', 'Link this browser',
         'Three steps on the computer: save a passkey here, let your phone say yes, done. The account, its plans and its key fingerprint stay the same; this browser just gets its own way in.',
         note='<b>Why a passkey first.</b> The browser makes its passkey before the phone is involved, so the phone has something specific to approve, and the browser can keep what the phone sends scrambled under its own passkey. If the person stops after step 1, the passkey saved here simply isn\'t connected to anything; 166 is shown again next time.')

item3('L', '168', 'Step 1: Save a passkey for this browser',
      'Says what\'s about to happen in three lines: a new passkey for this browser, the phone approves, still one account.',
      '166 → Link this browser to your account; 176 → Link this browser instead.',
      'Save a passkey here → the browser\'s create dialog (103 Chrome, 105 Safari) → 169. Cancel in that dialog → stays here with 130\'s “No passkey was saved” banner. Back → 166.',
      'The create dialog shows the passkey\'s label as “Plans” (we don\'t know the name yet; see open questions). Phone browsers: Apple\'s or Google\'s own sheet.',
      'both', (s168_lap, s168_ph))

item3('L', '169', 'Step 2: Open Plans on your phone',
      'The computer\'s half of the handshake: a big QR, the same code in letters, and three pictures to compare. Static: “Waiting for your phone…” with the time it runs out, no spinner.',
      '168 after the passkey is saved.',
      'Phone confirms (173) → 170 on its own, no click needed. Cancel → 166; the code stops working at once. 14:32 passes → 176 (code ran out).',
      'Code: 12 letters and numbers in three groups, no O or I. One use; 10 minutes. The pictures come from this one link, not from the account, so they\'re different every time. Losing the connection → 176 (third state).',
      'both', (s169_lap, s169_ph))

item3('L', '170', 'Step 3: This browser is linked',
      'Proof it\'s the same account: name, avatar, the plans, and the account\'s own key fingerprint with “Same as on your phone”.',
      '169 when the phone confirms.',
      'Go to my plans → 108 Home. Later visits → 177.',
      'Plans load from the account like 107; a plan that fails shows “Try again” on its own row. The phone shows 174 at the same moment.',
      'both', (s170_lap, s170_ph))

section3('P', 'On the phone',
         'The Android app\'s half. You gets an “Add a browser” row; the phone scans or types the code, shows the same three pictures, and only sends after “They match” and a fingerprint.')

item3('P', '171', 'You: “Add a browser” (53, revised)',
      'One new row on the approved You screen, under “Phones and browsers” (renamed from “Phones with your passkey”, since linked browsers are listed there too).',
      'You tab.',
      'Add a browser → 172. Phones and browsers → list with each linked browser as “Chrome on a Mac · Linked · its own passkey” and Remove.',
      'The “New” chip goes after the first visit. Everything else is 53 unchanged.',
      'phone', lambda t: ap(t, you_phone(), tab='you', h=1070))

item3('P', '172', 'Add a browser: scan, or type the code',
      'The camera opens straight away, framed for the computer\'s QR. Anyone who can\'t scan types the 12-letter code instead.',
      '171 → Add a browser.',
      'Code recognised (or Continue) → 173. Wrong code → 175. Code ran out or already used → 175.',
      'Always dark while the camera is on. No camera permission: the type-in screen opens first with “Allow camera” above it. The code field adds the dashes itself.',
      'phones', lambda t: [ap(t, scanner(), scr='cam'), ap(t, type_code())], labels=['Scan', 'Type the code'])

item3('P', '173', 'Check the pictures',
      'The one decision that matters: do these three pictures match the computer\'s screen? Then the fingerprint, then the phone sends. Names the computer so a code from someone else stands out.',
      '172 once a valid code is scanned or typed.',
      'They match · Confirm with fingerprint → Android\'s passkey sheet (46) → 174. They don\'t match → 175 (stop, nothing was sent). × → back to 172; the code still works until 14:32.',
      'The device label comes from the computer and is a hint, not proof; the pictures are the real check. No connection after the fingerprint → 175 (network).',
      'phone', lambda t: ap(t, check_body(), h=900))

item3('P', '174', 'Sent',
      'Done on the phone, and what it means in one sentence: the browser has its own passkey, the phone keeps its own.',
      '173 after the fingerprint.',
      'Done → 171.',
      'A notice goes to this phone (and any other phone on the account): “Chrome on a Mac can now use your account. Not you? Remove it.”',
      'phone', lambda t: ap(t, sent_body(), h=900))

section3('E', 'When something goes wrong',
         'Every failure says what happened, that nothing was sent or changed, and the one next step.')

item3('E', '175', 'Phone: pictures don\'t match, code problems, no connection',
      'Five phone states. The mismatch screen is the important one: stop, nothing was sent, make a new code. None of them changes the account.',
      '173 → They don\'t match; 172 with a code that ran out, was used, or was typed wrong; 173 with no connection.',
      'Done → 171. Scan a new code → 172. Try again → repeats the send; Cancel → 171.',
      'A code works once and runs out after 10 minutes; the computer then shows 176 (code ran out) with “Make a new code”. After “They don\'t match” nothing was sent; the computer keeps waiting until its code runs out or the person cancels. A typed code that doesn\'t exist simply finds nothing: codes are long enough (12 characters) that guessing one in 10 minutes isn\'t practical.',
      'phones', lambda t: [ap(t, err_mismatch()), ap(t, err_expired()), ap(t, err_used()), ap(t, type_code(err=True)), ap(t, check_body('net'), h=900)],
      labels=['Pictures don\'t match', 'Code ran out', 'Code already used', 'Wrong code typed', 'No connection'])

item3('E', '176', 'Computer: phone\'s passkey couldn\'t be used, code ran out, no connection',
      'The three computer-side failures. The first is specific to option one: some browsers use a phone\'s passkey to unlock but don\'t hand over the part Plans needs to open receipts, so Plans says so and points at linking.',
      '167 when the browser\'s answer is missing what Plans needs; 169 after 14:32 or a “They don\'t match” on the phone; 169 with no connection.',
      'Link this browser instead → 168. Make a new code → 169 with a new code and new pictures. Try again → 169.',
      'Nothing is saved in the first case: the person isn\'t let in half-way. In the second, the old QR is greyed so it can\'t be scanned by mistake.',
      'laps', lambda t: [
          s166_lap(t, banner=bn('neg', 'phone', 'Your phone\'s passkey couldn\'t be used here',
                                'This browser didn\'t give Plans what it needs from a phone\'s passkey. Your account is fine. Link this browser instead; it takes a minute.') + '<div class="mt16"></div>', hi=2),
          s169_lap(t, 'expired'), s169_lap(t, 'net')],
      labels=['Phone\'s passkey couldn\'t be used', 'Code ran out', 'No connection'])

section3('Y', 'Later, in a linked browser',
         'A linked browser behaves like any other: its own passkey unlocks it, and it can be removed from the account without touching anything else.')

item3('Y', '177', 'Unlock in a linked browser',
      'Note screen. Nothing new to learn: Unlock (or “I already use Plans”) uses the passkey saved in this browser. One small line says it\'s linked.',
      'plans.0xo.in/app in a browser that was linked before.',
      'Unlock with passkey → the browser\'s chooser (106) → 108 Home. Use another account → 102.',
      'If the browser\'s passkey was deleted from its password manager, Unlock finds nothing → 166, where linking again takes a minute. If the browser was removed from the account (178) → 102 with “This browser was removed from your account.”',
      'lap', lambda t: lap(t, 'plans.0xo.in/app', WELCOME_ILLO + unlock_right()))

item3('Y', '178', 'You: linked browser in “Devices with your passkey” (118, revised)',
      'The linked browser is listed as “Linked · its own passkey”. Remove opens in the right panel, so the list stays in view, and says plainly that it only stops this browser.',
      '118 → Remove next to a linked browser (here, the one in use).',
      'Remove · Confirm with passkey → this browser goes back to 102 with “This browser was removed from your account.” Cancel → 118. Removing another browser from here works the same and leaves this browser as it is.',
      'The phone can remove it too (171 → Phones and browsers). “+ Link another browser” opens 168 in a new tab on the computer you\'re linking.',
      'lap', s178)


CSS3 = r'''
/* ===== Link-a-browser addendum. Same tokens; nothing redefines a colour. ===== */
.lsteps{display:inline-flex;gap:5px;align-items:center}
.lsteps i{width:22px;height:6px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}
.lsteps i.on{background:var(--ink);box-shadow:none}
.lcode{font:600 30px/1.15 'IBM Plex Mono',monospace;letter-spacing:.05em;white-space:nowrap}
.lcode i{font-style:normal;color:var(--muted);margin:0 -.12em}
.emo3{display:inline-flex;gap:.45em;padding:.28em .6em;border-radius:999px;background:var(--surface);border:1px solid var(--line);line-height:1}
.emo3.big{gap:.35em;padding:.3em .55em}
.opt{display:flex;align-items:center;gap:14px;padding:16px 18px;border-radius:16px;background:var(--surface);border:1.5px solid var(--line)}
.opt .lt{font-size:16.5px}
.opt.hi{border-color:var(--ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent)}
.waitl{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;background:var(--surface-2)}
.qrpad{display:inline-block;padding:12px;background:#fff;border-radius:18px;box-shadow:0 0 0 1px var(--line);flex:none}
.qrpad.dim{opacity:.25;filter:grayscale(1)}
.addb{box-shadow:0 0 0 2px var(--accent);border-radius:14px;background:color-mix(in srgb,var(--accent) 10%,var(--surface));padding:8px 10px!important;margin:4px -10px;border-bottom:0!important}
.lap .mc.c .li{text-align:left}
.rmsel{box-shadow:0 0 0 2px var(--neg);border-radius:12px;padding:8px 10px!important;margin:4px -10px;border-bottom:0!important}
.fld.err{border-color:var(--neg);box-shadow:0 0 0 3px color-mix(in srgb,var(--neg) 22%,transparent)}
.lscrim{position:absolute;inset:0;background:var(--scrim);z-index:30}
.lmodal{position:absolute;left:50%;top:150px;width:500px;margin-left:-250px;z-index:31;background:var(--surface);border-radius:22px;padding:28px;box-shadow:var(--shadow),0 0 0 1px var(--line)}
/* computer screen seen through the phone camera */
.lscreen{position:absolute;left:55px;top:214px;width:280px;height:212px;border-radius:10px;background:#E9EDE6;box-shadow:0 0 0 6px #2a2f2c,0 24px 40px rgba(0,0,0,.55);
  transform:perspective(600px) rotateX(6deg) rotate(-2deg);display:flex;flex-direction:column;overflow:hidden;opacity:.94}
.lsbar{height:14px;background:#cfd5cc;flex:none}
/* iPhone passkey sheet (Apple's, drawn generically) */
.ios-scrim{position:absolute;inset:0;background:var(--scrim);z-index:35}
.ios{position:absolute;left:8px;right:8px;bottom:8px;z-index:36;border-radius:26px;padding:22px 18px 16px;font:400 15px/1.4 -apple-system,system-ui,sans-serif;text-align:center}
.phone.light .ios{background:#F2F2F7;color:#1C1C1E}.phone.dark .ios{background:#2C2C2E;color:#F2F2F7}
.ios .ik{width:50px;height:50px;margin:0 auto 10px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(#5AC8FA,#0A84FF);color:#fff}
.ios .it{font-weight:700;font-size:17px;margin-bottom:4px}
.ios p{margin:0 0 16px;opacity:.7;font-size:14px}
.ios .iopt{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:14px;color:#0A84FF;font-weight:600}
.phone.light .ios .iopt{background:#fff}.phone.dark .ios .iopt{background:#3A3A3C}
.ios .iopt.can{color:inherit;font-weight:500}
/* addendum page layout */
.lpair{display:flex;flex-wrap:wrap;gap:24px 24px;max-width:100%;padding-bottom:4px}
.lpair figure{margin:0;flex:none}
.lpair figcaption{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--p-muted);margin:0 0 8px 14px}
.subh{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--p-ink);margin:28px 0 12px;display:flex;align-items:center;gap:10px}
.subh::after{content:"";flex:1;height:1px;background:var(--p-line)}
.sec2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;margin-top:12px}
.sec2 div{background:var(--p-surface);border:1px solid var(--p-line);border-radius:14px;padding:14px 16px;font-size:14.5px;line-height:1.5}
.sec2 b{display:block;font:700 16px 'Bricolage Grotesque',sans-serif;margin-bottom:4px}
.oq{background:var(--p-surface);border:1px solid var(--p-line);border-radius:14px;padding:6px 20px;max-width:110ch}
.oq li{margin:10px 0;font-size:15px}
'''
