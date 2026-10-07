from b2core import *
from b2a import WELCOME2, welcome_body, site_top, site_facts, LIS

SHA = '3f9a1c7e0b529d84e6a17c3352f0b8de41a907c69e15d2bb6f08a4c17d3e92b5'
SHA_SPACED = ' '.join(SHA[i:i + 8] for i in range(0, 64, 8))


def rule_line(t):
    return f'<div class="row" style="align-items:flex-start;gap:10px"><span class="pos" style="margin-top:1px">{ic("check", 18, 2.4)}</span><span class="t15">{t}</span></div>'


RULES = ['Spends up to $25 go through straight away.',
         '$25–$200 needs one friend\'s OK. Over $200 needs 3 of 4.',
         'Each person can spend up to $150 a day.',
         'Anyone in a split can question a spend for 48 hours.',
         'What\'s left is shared out when the plan ends.',
         'Safety net: up to $100 each, only if someone owes at the end.']


def anon(flag, c='#7a8a99', s=40):
    return f'<span class="av" style="--c:{c};--s:{s}px">{ic("user", int(s * .5), 2)}<b>{flag}</b></span>'


ANON = ''.join(anon(f, s=40) for f in ['🇬🇧', '🇬🇧', '🇺🇸', '🇮🇳'])

NOT_SHOWN = ('<div class="card t"><div class="row" style="gap:8px">' + ic('eye', 18, 2) + '<span class="lt">Not shown here</span></div>'
             '<p class="t13" style="margin:6px 0 0">Names, who paid for what, what anything was for, receipts, photos, notes, and anyone\'s balance. Only members see those, after they join.</p></div>')

FRAG = ('<p class="t11 mut" style="margin:10px 0 0">The plan name is unlocked in this browser by the part of the link after “#”. '
        'Browsers never send that part to Plans, so our servers can\'t read it.</p>')


def shared_card(big=False):
    d = 'd34' if big else 'd22'
    return ('<div class="pc">' + wb(LIS, 'Lisbon · 12–16 Oct · 5 days') +
            f'<div class="pcb"><div class="row">{emo("🌊", LIS, 56 if big else 48)}<div class="lm"><div class="{d}">Lisbon, 12–16 Oct</div>'
            f'<div class="t13 mut row" style="gap:6px">{ic("lock", 13, 2.2)}Name unlocked in this browser</div></div></div>'
            '<div class="row mt16" style="gap:20px;flex-wrap:wrap">'
            '<div><div class="ov">Dates</div><div class="b mt4">Mon 12 – Fri 16 Oct</div></div>'
            '<div><div class="ov">In the pot</div><div class="b mt4">$446.00</div></div>'
            '<div><div class="ov">People</div><div class="b mt4">4 · 3 countries</div></div></div>'
            f'<div class="row mt12" style="gap:6px">{ANON}<span class="t13 mut" style="margin-left:6px">🇬🇧 2 · 🇺🇸 1 · 🇮🇳 1</span></div></div></div>')


def shared_phone():
    return (f'<div class="webtop">{logo(20)}' + btn('Open in app', 'sec', cls='sm', style='height:36px') + '</div>'
            + f'<span class="chip sm inf" style="align-self:flex-start">{ic("link", 14, 2.2)}Invitation · read-only</span>'
            + '<h2 class="d28 mt12">You\'re invited to a plan</h2>'
            + '<div class="mt12">' + shared_card() + '</div>'
            + '<div class="ov mt20">The rules, in plain words</div><div class="col8 mt8">' + ''.join(rule_line(r) for r in RULES[:5]) + '</div>'
            + '<div class="mt16">' + NOT_SHOWN + '</div>'
            + '<div class="sp" style="min-height:12px"></div>'
            + btn('Join with fingerprint', 'pri', 'fp') + btn('Continue in your browser', 'sec', cls='mt8') + FRAG)


section('B', 'A plan from a shared link',
        'A read-only web page for people who aren\'t members yet. The name is unlocked in their browser from the link; counts and rules are public; nothing personal is.')

item('B', '122', 'Shared plan: phone',
     'What Asha sees opening Maya\'s link before she has Plans: the plan, its dates, how many people from where, the pot, and the rules in plain words. One button to join.',
     'plans.0xo.in/p/7kq2#… opened on a phone without the app.',
     'Join with fingerprint → opens the Android app at 14 if installed; otherwise continues in the web app (01/02 → 03 → 15). Continue in your browser → web app join. Open in app → Play-free install via /download.',
     'Plan ended: the card says “Ended 16 Oct” and Join is replaced by “Ask Maya for a new plan”. Link turned off: 14b copy. Plan full (50): “This plan is full”.',
     'phone', lambda t: mphone(t, shared_phone(), h=1090, url='plans.0xo.in/p/7kq2#••••'))


def shared_lap():
    left = ('<div style="width:620px">' + f'<span class="chip sm inf">{ic("link", 14, 2.2)}Invitation · read-only</span>'
            + '<h1 class="d44 mt12">You\'re invited to a plan</h1><div class="mt16">' + shared_card(True) + '</div>'
            + '<div class="ov mt24">The rules, in plain words</div><div class="g2c mt8" style="gap:10px 24px">' + ''.join(rule_line(r) for r in RULES) + '</div></div>')
    right = ('<div style="width:400px"><div class="mc" style="padding:24px"><div class="d22">Join Lisbon</div>'
             '<p class="t15 mut" style="margin:6px 0 16px">You\'ll see who\'s in, every spend and every receipt once you join.</p>'
             + btn('Join with your passkey', 'pri', 'key', 'lg') + btn('Get the Android app', 'sec', 'download', 'mt8')
             + '<p class="t13 mut" style="margin:12px 0 0">Joining asks you to add money only if you want to. You can do it later.</p></div>'
             + '<div class="mt12">' + NOT_SHOWN + '</div>' + FRAG + '</div>')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{site_top()}'
            f'<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:72px;padding:0 48px">{left}{right}</div>{site_facts()}</div>')


item('B', '123', 'Shared plan: laptop',
     'The same page on a laptop: the plan on the left, joining on the right, and the “not shown here” list next to the button so it\'s read before anyone joins.',
     'plans.0xo.in/p/7kq2#… in a desktop browser.',
     'Join with your passkey → web app welcome (102) if no account, then the invite (14 content, centred) → 109. Get the Android app → 133.',
     'Same ended / off / full states as 122.',
     'lap', lambda t: lap(t, 'plans.0xo.in/p/7kq2#••••', shared_lap()))


def missing_phone():
    return (f'<div class="webtop">{logo(20)}</div>'
            + f'<div class="sp"></div><div class="bigic m">{ic("link", 32, 2)}</div>'
            + '<h2 class="d28 c mt16">This link is missing its last part</h2>'
            + '<p class="t15 mut c" style="margin:8px 8px 20px">Some messaging apps cut long links. Without the end of it we can\'t unlock the plan\'s name, and you can\'t join.</p>'
            + '<div class="card"><div class="row">' + emo('🔒', LIS) + '<div class="lm"><div class="lt">A plan on Plans</div><div class="t13 mut">4 people · 3 countries · ends 16 Oct</div></div></div></div>'
            + '<div class="sp"></div>' + btn('Ask for the whole link', 'pri', 'share') + btn('What is Plans?', 'txt', cls='mt4'))


item('B', '124', 'Shared link without its secret',
     'Added state. When a messenger strips the end of the link, say so plainly instead of showing a broken page.',
     'plans.0xo.in/p/7kq2 with no “#…” part, or a damaged one.',
     'Ask for the whole link → share sheet with “Can you send the Plans link again? Mine was cut off.”',
     'Public facts (count, countries, end date) still show, because they don\'t need the secret.',
     'phone', lambda t: mphone(t, missing_phone(), url='plans.0xo.in/p/7kq2'))

# ================================================================== C. First run
section('C', 'First-run fixes',
        'What the first-three-minutes test found: silent cancels, an unexplained wait, a fake button, and a download page with nothing to download. Each fix is drawn.')

item('C', '125', 'Welcome without the language pill (B6)',
     'The “English” pill looked like a button and did nothing. It\'s gone; the logo sits alone. A real language menu can come back in You when there are translations.',
     'App launch with no account.', 'Same as 01.',
     'Everything else on 01 is unchanged.',
     'phone', lambda t: aphone(t, WELCOME2()))

LOADING = (f'<span class="btn pri" style="opacity:.9"><span class="spin"></span>Opening passkey…</span>')

item('C', '126', 'Waiting for the passkey sheet (B5)',
     'If Android takes more than about a second to show its sheet, the button says what\'s happening so the tap doesn\'t feel lost.',
     '125 → Create account (or I already use Plans).',
     'Sheet appears → 02 (or 04). After 15 s with no sheet → 129.',
     'Under 1 s nothing changes, so fast phones never see it. The second button is disabled meanwhile. Measure the real delay on the test phones first (research B5).',
     'phone', lambda t: aphone(t, WELCOME2(create=LOADING).replace(
         btn('I already use Plans', 'sec', cls='mt8'), btn('I already use Plans', 'off', cls='mt8')).replace(
         'No passwords. Your fingerprint is your key.', 'Your phone is getting the passkey ready.')))

item('C', '127', 'Passkey cancelled (B4)',
     'Today a cancel drops back to Welcome with no message. Now it says what happened, and that nothing was made.',
     'Cancel on the passkey sheet (02/04), or backing out of Google\'s extra screen-lock check.',
     'Try again → 02. I already use Plans → 04. Banner clears on the next tap.',
     'Same banner after restore (04): “You weren\'t signed in to anything. Try again when you\'re ready.”',
     'phone', lambda t: aphone(t, WELCOME2(banner=bn('mut', 'info', 'No account was made', 'You closed the passkey step before it finished. Nothing was saved.') + '<div class="mt12"></div>',
                                         create=btn('Try again', 'pri', 'fp'))))

item('C', '128', 'Passkeys not available (B4)',
     'When the phone has no passkey service, say so on Welcome and lead to the steps (06) instead of failing silently.',
     'Create account when Android reports no passkey provider.',
     'How to turn it on → 06. Try again → 02.',
     'Variant: no screen lock set: “Set a screen lock first, then try again.”',
     'phone', lambda t: aphone(t, WELCOME2(banner=bn('neg', 'key', 'This phone can\'t save a passkey yet', 'Plans needs a passkey service like Google Password Manager turned on.') + '<div class="mt12"></div>',
                                         create=btn('How to turn it on', 'pri')).replace(btn('I already use Plans', 'sec', cls='mt8'), btn('Try again', 'sec', cls='mt8'))))

item('C', '129', 'Couldn\'t finish setting up (B4)',
     'The honest version of a network failure after the passkey was made: the passkey exists, the account doesn\'t yet, and trying again reuses it.',
     'Passkey saved but Plans couldn\'t be reached; or no sheet after 15 s (126).',
     'Try again → finishes with the same passkey, no new sheet. Back online is detected automatically.',
     'If the passkey wasn\'t saved either, the copy says “Nothing was saved” instead.',
     'phone', lambda t: aphone(t, WELCOME2(banner=bn('neg', 'wifioff', 'Couldn\'t finish setting up', 'Your passkey was saved, but we couldn\'t reach Plans. Check your connection and try again. We\'ll use the same passkey.') + '<div class="mt12"></div>',
                                         create=btn('Try again', 'pri', 'refresh'))))

CANCEL_LAP = ('<div style="width:520px;margin-bottom:20px">' + bn('mut', 'info', 'No account was made',
              'You closed the passkey step before it finished. No fingerprint reader? Choose “Use a phone or tablet” in the browser\'s dialog.') + '</div>')

item('C', '130', 'Passkey cancelled: laptop',
     'The same fix in the web app, with one extra hint, because on laptops the usual reason is “no fingerprint reader”.',
     '103, 104, 105 or 106 → Cancel, or the browser\'s dialog timing out.',
     'Try again → the browser\'s dialog. I already use Plans → 106.',
     'Not supported (old browser): “This browser can\'t use passkeys. Try Chrome, Safari, Edge or Firefox, or the Android app.” Network: 129\'s copy.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app', welcome_body(CANCEL_LAP, btn('Try again', 'pri', 'key', 'lg'))))


# ------------------------------------------------------------------ landing + download
def land_nav():
    return (f'<div class="row sbw" style="height:76px;padding:0 56px;flex:none">{logo(26)}'
            '<div class="row t15 b mut" style="gap:28px"><span>How it works</span><span>Group rules</span><span>Across borders</span><span>Numbers</span><span>Docs</span></div>'
            + btn('Open the web app', 'sec', cls='sm') + '</div>')


def flags_pill():
    return ('<span class="row" style="display:inline-flex;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 16px 6px 8px">'
            '<span style="font-size:20px;letter-spacing:2px">🇬🇧🇺🇸🇮🇳🇵🇹</span><span class="t15 b">Friends in four countries, one pot</span></span>')


def qr_card(title, sub):
    return ('<div class="mc" style="width:340px;padding:24px;text-align:center">'
            f'<div class="ov">{title}</div>'
            f'<div style="display:inline-block;padding:10px;background:#fff;border-radius:16px;margin-top:14px">{qr("download", 200, center=QR_LOGO)}</div>'
            '<div class="mono t13 mt12">plans.0xo.in/download</div>'
            f'<p class="t13 mut" style="margin:8px 0 0">{sub}</p></div>')


QR_LOGO = '<span class="logo" style="font-size:13px"><span class="lb"></span></span>'


def landing():
    hero = ('<div style="flex:1;max-width:760px">' + flags_pill()
            + '<h1 class="d56" style="font-size:76px;margin-top:24px">A shared pot for every plan, wherever your <span style="background:linear-gradient(transparent 62%,var(--accent) 62% 92%,transparent 92%)">friends</span> live.</h1>'
            + '<p class="t17 mut" style="font-size:20px;margin:20px 0 28px;max-width:640px">Join with one fingerprint. Spend from the pot under rules the group agrees on. When the plan ends, everyone is settled in one tap, in pounds, dollars or rupees.</p>'
            + '<div class="row" style="gap:12px">' + btn('Get the Android app <span class="chip sm" style="height:24px;background:rgba(16,35,27,.12);color:#10231B">Test version</span>', 'pri', cls='lg', style='width:auto;padding:0 26px')
            + btn('Use Plans in your browser', 'sec', cls='lg', style='width:auto;padding:0 26px') + '</div>'
            + '<p class="mono t13 mut" style="margin:22px 0 0">No bank account in common. No app password. Free for groups.</p></div>')
    right = qr_card('On a laptop? Get it on your phone', 'Scan with your Android phone\'s camera. On iPhone, Plans works in Safari.')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{land_nav()}'
            f'<div style="flex:1;display:flex;align-items:center;gap:72px;padding:0 96px 40px">{hero}{right}</div></div>')


item('C', '131', 'Landing page for desktop visitors (B8)',
     'Judges on laptops couldn\'t try anything. Now the hero offers both ways in: a QR that opens /download on their phone, and “Use Plans in your browser”. The CTA states only what\'s true.',
     'plans.0xo.in on a screen wider than 1024 px.',
     'Get the Android app → /download (133). Use Plans in your browser → 102. QR → /download on the phone (132).',
     'On phones the QR card is hidden and the buttons stack (as today). The CTA tag reads “Test version” once release.json says live, and “Coming soon” before. No “Beta · 12 Oct”.',
     'lap', lambda t: lap(t, 'plans.0xo.in', landing()))


def dl_cards(phone=False):
    shs = SHA_SPACED
    if phone:
        g = SHA_SPACED.split(' ')
        shs = ' '.join(g[:4]) + '<br>' + ' '.join(g[4:])
    sha = (f'<div class="ov mt16">SHA-256</div><div class="mono t13" style="margin-top:6px;padding:10px 12px;border-radius:12px;background:var(--surface-2);line-height:1.6">{shs}</div>'
           f'<div class="row sbw t13 mt8"><span class="b row" style="gap:6px">{ic("copy", 15, 2)}Copy</span><span class="mut">How to check it</span></div>')
    test = ('<div class="mc" style="padding:20px"><div class="row sbw"><span class="d28">Plans Test</span><span class="chip sm ol mono" style="font-size:11px">MONAD TESTNET</span></div>'
            '<div class="row mt8" style="gap:8px"><span class="chip sm pos">Available now</span><span class="chip sm acc">Test version · free test dollars</span></div>'
            '<p class="t15 mut" style="margin:10px 0 14px">Everything works, with test dollars that have no value. Installs alongside the real app later.</p>'
            + btn('Download Plans Test · 41.2 MB', 'pri', 'download', 'lg')
            + '<div class="row t13 mut mt12" style="gap:16px;flex-wrap:wrap"><span>Version 1.0.0-test.4</span><span>Published Fri 9 Oct 2026</span><span>Android 9+</span></div>'
            + sha + '</div>')
    main = ('<div class="mc" style="padding:20px"><div class="row sbw"><span class="d28">Plans</span><span class="chip sm acc mono" style="font-size:11px">MONAD MAINNET</span></div>'
            '<p class="t15 mut" style="margin:10px 0 14px">The real app, with real digital dollars (AUSD). Published here with its SHA-256 after launch.</p>'
            + btn('After launch', 'off', 'clock') + '</div>')
    steps = ('<div class="mc t"><div class="lt">Installing takes about a minute</div><div class="col8 mt8 t15">'
             '<div class="step"><span class="n">1</span><div>Tap Download, then open the file.</div></div>'
             '<div class="step"><span class="n">2</span><div>Android asks once to allow installs from your browser. Allow it.</div></div>'
             '<div class="step"><span class="n">3</span><div>Open Plans Test and tap Create account. Google may ask for your screen lock once.</div></div></div></div>')
    return test, main, steps


def dl_phone():
    test, main, steps = dl_cards(True)
    return (f'<div class="webtop">{logo(20)}' + btn('Get the app', 'pri', cls='sm', style='height:36px') + '</div>'
            + '<span class="chip sm ol mono" style="align-self:center;font-size:11px">ANDROID · TEST VERSION</span>'
            + '<h1 class="d34 c mt12">Get Plans for Android</h1>'
            + '<p class="t15 mut c" style="margin:8px 8px 16px">Installed straight from this page. No SIM, VPN or local account needed.</p>'
            + test + '<div class="mt12">' + steps + '</div><div class="mt12">' + main + '</div>'
            + f'<p class="t15 c mt16" style="margin-bottom:0">No Android phone? <b style="text-decoration:underline">Use Plans in your browser</b></p>')


item('C', '132', 'Download page with a real test build: phone',
     'The dead end becomes a download: version, size, publish date and SHA-256 for the published test build, labelled “Test version · free test dollars”. The real-money app says “After launch” and nothing else.',
     'Landing “Get the Android app”; the QR on 131; plans.0xo.in/download.',
     'Download → the APK from GitHub Releases. Use Plans in your browser → 01 in the web app.',
     'Values come from release.json (sample shown: 1.0.0-test.4, 41.2 MB, the SHA-256 is a placeholder). Before publishing, the test card shows today\'s “Coming soon” copy with no fake numbers.',
     'phone', lambda t: mphone(t, dl_phone(), h=1290, url='plans.0xo.in/download'))


def dl_lap():
    test, main, steps = dl_cards()
    left = ('<div style="width:620px"><span class="chip sm ol mono" style="font-size:11px">ANDROID · TEST VERSION</span><h1 class="d56 mt12">Get Plans for Android</h1>'
            '<p class="t17 mut" style="margin:6px 0 14px">Installed straight from this page. No SIM, VPN or local account needed.</p>'
            + test + '<div class="row mt12 t13 mut" style="gap:18px"><span><b style="color:var(--ink)">1</b> Download, open the file</span><span><b style="color:var(--ink)">2</b> Allow installs from your browser once</span><span><b style="color:var(--ink)">3</b> Open Plans Test, Create account</span></div></div>')
    right = ('<div style="width:360px">' + qr_card('Scan to download on your phone', 'Opens this page on your Android phone. iPhone? Plans works in Safari.')
             + '<div class="mt12">' + main + '</div>'
             + '<div class="mt12">' + btn('Use Plans in your browser', 'sec', 'monitor') + '</div></div>')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{land_nav()}'
            f'<div style="flex:1;display:flex;align-items:flex-start;justify-content:center;gap:56px;padding:12px 56px 0">{left}{right}</div></div>')


item('C', '133', 'Download page: laptop',
     'On a laptop the page leads with the QR, because the APK is useless on the laptop itself. The browser option sits right under it.',
     'plans.0xo.in/download on a desktop browser.',
     'QR → 132 on the phone. Download still works (people sometimes transfer the file). Use Plans in your browser → 102.',
     'Install steps move under the QR card when the window is narrower than 1280.',
     'lap', lambda t: lap(t, 'plans.0xo.in/download', dl_lap()))
