import base
from b2core import *
from b2a import shell, plan_main, LIS, AUSD, site_top, MEMBERS
from b2b import land_nav, flags_pill, QR_LOGO
from s3 import PAPER

SCR = {s['n']: s for s in base.SCREENS}
ROUND_GBP = '18446744073709562301'
ROUND_INR = '18446744073709551942'


def checklink():
    return f'<span class="t13 b inf row" style="gap:4px;text-decoration:underline;text-underline-offset:3px">{ic("search", 14, 2.2)}Check this rate</span>'


# ================================================================== G. Group 2
section('G', 'Group 2',
        'Designed now, built after the Group 1 items. Each is drawn in the same system so it can be built without another design pass.', g2=True)

SEND_STUB = stub('<div class="row sbw"><span class="ov">Plans · sent</span><span class="t13 mut mono">#7Q2-1405</span></div>'
                 f'<div class="row mt8" style="gap:10px"><span class="d34">£1.50</span><span class="mut">{ic("chev", 22, 2.4)}</span><span class="d34">$2.02</span></div>',
                 [('From', 'Maya · London 🇬🇧'), ('To', 'Sam · New York 🇺🇸'),
                  ('Applied', '1 GBP = 1.3472 USD'), ('Reference', '1.3472 · Chainlink · 14:05:02 UTC'),
                  ('Round', ROUND_GBP), ('Difference', '0.00% · $0.00'), ('Fee', '$0.00'), ('When', 'Tue 13 Oct · 14:05:12')],
                 f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}')


def send_receipt():
    return (f'<div class="c mt8"><div class="bigic p">{ic("check", 36, 2.4)}</div><h2 class="d34 mt12">Sent</h2>'
            '<p class="t15 mut" style="margin:6px 16px 16px">Sam got $2.02 in New York.</p></div>'
            + SEND_STUB + f'<div class="row mt12" style="justify-content:center">{checklink()}</div>'
            + '<div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Done') + '</div>')


item('G', '150', 'Rate lines on a Send receipt (7)',
     'The receipt (47) gains three compact lines: the reference rate with its source and time, its round number, and the difference from the rate applied. One link opens the check.',
     '45 → 46 → this receipt.', 'Check this rate → 152. Proof → the payment\'s public record.',
     'Difference is 0.00% when Plans applies the reference exactly; any spread is shown as a percentage and in the receiver\'s money. Round number is a sample.',
     'phone', lambda t: aphone(t, send_receipt(), h=900), g2=True)


def settle_rates():
    return (ab('', icon='x')
            + '<div class="c"><h2 class="d28">All settled</h2></div>'
            + '<div class="mt12">' + stub('<div class="row sbw"><span class="ov">Lisbon, 12–16 Oct · settle-up</span><span>🌊</span></div><div class="d28 mt8">$112.40 paid out</div>',
                                         [('Maya · London', '<b>£38.86</b>'), ('Sam · New York', '<b>$28.10</b>'), ('Asha · Bengaluru', '<b>₹1,674</b>'), ('Ben · Manchester', '<b>£8.86</b>'),
                                          ('', 'GBP · applied 1.3472 · reference 1.3472 · 0.00%'),
                                          ('', f'Chainlink round {ROUND_GBP} · 10:42:05 UTC'),
                                          ('', 'INR · applied 83.60 · reference 83.61 · 0.01%'),
                                          ('', f'Chainlink round {ROUND_INR} · 10:42:01 UTC'),
                                          ('Difference', '₹0.20 less for Asha · $0.00 for the rest')],
                                         f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}') + '</div>'
            + f'<div class="row mt12" style="justify-content:center">{checklink()}</div>'
            + '<div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Done') + '</div>')


item('G', '151', 'Rate lines on a settle-up receipt (7)',
     'The settle-up stub (40) with one pair of lines per currency used: applied, reference, difference, and the round with its time. A total difference line says who it affected, in their money.',
     '39 → 40 when the plan used more than one currency.', 'Check this rate → 152 with a currency switcher.',
     'Only currencies that were paid out get lines. Shown here with a small INR spread to prove the line is honest, not decorative.',
     'phone', lambda t: aphone(t, settle_rates(), h=900), g2=True)


def rate_sheet():
    return ('<h3 class="d22">Check this rate</h3>'
            '<p class="t13 mut" style="margin:4px 0 12px">Pounds to dollars for your payment to Sam.</p>'
            '<div class="card col8 t15">'
            '<div class="row sbw"><span class="mut">Plans used</span><span class="b">1 GBP = 1.3472 USD</span></div>'
            '<div class="row sbw"><span class="mut">Reference</span><span class="b">1 GBP = 1.3472 USD</span></div>'
            '<div class="row sbw"><span class="mut">Difference</span><span class="b pos">0.00% · $0.00</span></div></div>'
            '<div class="card t mt8 mono t11" style="line-height:1.8">Source: Chainlink GBP / USD price feed<br>'
            f'Round {ROUND_GBP}<br>Published 14:05:02 UTC · used 14:05:12 UTC</div>'
            '<div class="col8 mt12 t13">'
            f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("globe", 16)}</span>The reference is published in public by Chainlink, a price service many apps rely on. Anyone can look up this round.</div>'
            f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("clock", 16)}</span>Plans never uses a reference older than 1 hour. If it\'s older, we stop and ask you to try again.</div></div>'
            f'<div class="row sbw mt16"><span class="t13 mut">Look it up yourself</span>{proof()}</div>'
            + btn('Done', 'sec', cls='mt12'))


item('G', '152', '“Check this rate” sheet (7)',
     'For the curious and for judges: the rate used, the public reference it came from, the round and both times, the difference, and Proof for the reference itself.',
     '150, 151, the rate line on 45 (Send amount) and 18 (Add money).', 'Proof → the reference round on the Monad explorer. Done → back.',
     'If the reference is older than an hour, the action is blocked before confirming: “Rates are out of date. Try again in a minute.” This rule is a proposal.',
     'phone', lambda t: aphone(t, send_receipt(), h=900, over=app_sheet(rate_sheet())), g2=True)

TPL = [('🏙️', 'Weekend city break', '2–3 nights · stay, food, getting around', True), ('🎪', 'Festival', 'Tickets, camping, food, travel', False),
       ('🏔️', 'Ski week', 'Chalet, lift passes, gear, food', False), ('🏠', 'House share', 'Bills and groceries for a set period', False),
       ('🚐', 'Road trip', 'Fuel, stays, food, tolls', False), ('🎂', 'Birthday or dinner', 'One evening, one or two spends', False)]


def templates():
    tiles = ''.join(f'<div class="tpl{" on" if on else ""}"><div class="row sbw"><span style="font-size:28px">{e}</span>'
                    f'<span class="rad{" on" if on else ""}"></span></div><div class="lt">{n}</div><div class="t13 mut">{d}</div></div>' for e, n, d, on in TPL)
    return (ab('New plan', icon='x', right='<span class="t13 mut" style="margin-right:12px">1 of 3</span>')
            + '<h2 class="d28">What kind of plan?</h2>'
            + '<p class="t15 mut" style="margin:8px 0 14px">We\'ll suggest budgets for it. You can change every number.</p>'
            + f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">{tiles}</div>'
            + f'<div class="li nb mt8">{tile("sliders")}<div class="lm"><div class="lt">Start blank</div><div class="t13 mut">No budgets, Balanced rules</div></div>{ic("chev", 20)}</div>'
            + '<div class="sp"></div>' + btn('Next: people and days'))


item('G', '153', 'Trip templates in Create plan (8)',
     'A new first step in Create plan: pick the kind of plan and get sensible budgets. Six templates cover most groups; “Start blank” keeps today\'s flow.',
     'Home → New plan.', 'Next → 154. Start blank → 10.',
     'House share is one pot for a set period (up to a year), not monthly resets: recurring plans need contract changes and are out of scope.',
     'phone', lambda t: aphone(t, templates(), h=900), g2=True)


def stp(v):
    return f'<span class="stp"><i>−</i><b class="tnum" style="min-width:40px;text-align:center">{v}</b><i>+</i></span>'


def tbud(e, name, rate, calc, total):
    return (f'<div class="li" style="min-height:62px"><span class="et sm">{e}</span><div class="lm"><div class="lt">{name}</div>'
            f'<div class="t13 mut mono" style="font-size:12px">{rate} {calc}</div></div><span class="d17">{total}</span></div>')


def tpl_applied():
    return (ab('Weekend city break', sub='Porto, 6–8 Nov', right='<span class="t13 mut" style="margin-right:12px">2 of 3</span>')
            + '<div class="card"><div class="row sbw"><span class="lt">People</span>' + stp('4') + '</div>'
              '<div class="row sbw mt12"><span class="lt">Nights</span>' + stp('2') + '</div>'
              '<div class="t13 mut mt8">Fri 6 – Sun 8 Nov · 3 days</div></div>'
            + '<div class="row sbw mt20"><span class="ov">Suggested budgets</span><span class="t13 b">Edit</span></div>'
            + tbud('🛏️', 'Stay', '$40 a person a night', '× 4 × 2', '$320')
            + tbud('🍽️', 'Food &amp; drink', '$30 a person a day', '× 4 × 3', '$360')
            + tbud('🚋', 'Getting around', '$8 a person a day', '× 4 × 3', '$96')
            + tbud('🎟️', 'Tickets &amp; activities', '$20 a person a day', '× 4 × 3', '$240')
            + '<div class="card t mt12"><div class="row sbw"><span class="lt">Suggested pot</span><span class="d22">$1,016</span></div>'
              '<div class="t13 mut">About $254 each · £188.54 for you</div></div>'
            + '<p class="t13 mut" style="margin:10px 0 0">Suggestions only, based on mid-range prices. Rules start as Balanced; you can change them next.</p>'
            + '<div class="sp"></div>' + btn('Use these budgets'))


item('G', '154', 'Template budgets, scaled (8)',
     'Budgets per category scale with people and days, and each line shows its sum so the number is never a mystery.',
     '153 → Next.', 'Use these budgets → 11 (rules) with budgets filled in, then 13. Edit → 12.',
     'Changing people or nights updates every line at once. Per-person rates are per template and stored with the app, not fetched.',
     'phone', lambda t: aphone(t, tpl_applied(), h=940), g2=True)

TICK = ('<div class="ticker"><span class="dot" style="width:7px;height:7px"></span><span>GBP <b>1.3472</b></span><span>INR <b>83.60</b></span>'
        '<span>EUR <b>1.1619</b></span><span>14:05:02 UTC</span></div>')


def dbar(v, mx=24.25):
    w = abs(v) / mx * 50
    if v > 0:
        return f'<div class="dbar"><i style="left:50%;width:{w}%;background:var(--pos)"></i></div>'
    if v < 0:
        return f'<div class="dbar"><i style="right:50%;width:{w}%;background:var(--neg)"></i></div>'
    return '<div class="dbar"><i style="left:calc(50% - 7px);width:14px;background:var(--muted)"></i></div>'


AHEAD = [('maya', 'Maya (you)', '+£18.00', '$24.25', 24.25, 'pos'), ('sam', 'Sam', '$0.00', 'all square', 0, ''),
         ('asha', 'Asha', '−₹676', '−$8.08', -8.08, 'neg'), ('ben', 'Ben', '−£12.00', '−$16.17', -16.17, 'neg')]


def ahead_rows():
    return ''.join(f'<div class="mt12"><div class="row sbw">{av(k, 32)}<span class="lt lm">{n}</span><span class="d17 {c}">{a}</span><span class="t13 mut" style="width:72px;text-align:right">{b}</span></div>'
                   f'{dbar(v)}</div>' for k, n, a, b, v, c in AHEAD)


def ahead_phone():
    return (ab('Who\'s ahead, who owes', sub='Lisbon, 12–16 Oct')
            + '<div class="card t" style="padding:10px 14px">' + TICK + '</div>'
            + '<div class="seg mt12"><span class="on">Their own money</span><span>All in £</span><span>All in $</span></div>'
            + '<div class="card mt12"><div class="row sbw t11 mono mut"><span>OWES</span><span>AHEAD</span></div>' + ahead_rows() + '</div>'
            + '<div class="ov mt20">If the plan ended now</div>'
            + '<div class="card mt8" style="padding-top:22px">' + __import__('s3').edge('ben', 'maya', '£12.00') + '<div style="height:14px"></div>' + __import__('s3').edge('asha', 'maya', '₹676')
            + '<p class="t13 mut" style="margin:12px 0 0">Then what\'s left in the pot is shared 4 ways.</p></div>'
            + '<p class="t13 mut" style="margin:12px 0 0">Updates as spends land and rates change. Bars are drawn in dollars so they compare fairly; labels are in each person\'s money.</p>')


item('G', '155', 'Who\'s ahead, who owes (9)',
     'Each member\'s position in their own money, as bars from a centre line, with a rate ticker so it\'s clear why a number moved.',
     '16 → Why, or the member strip; 109 panel tab.', 'Edge → the spends behind it. All in £ / $ → relabels every amount.',
     'Live: values change in place without animating; the ticker time changes. Offline: ticker greys out with “Rates from 14:02”.',
     'phone', lambda t: aphone(t, ahead_phone(), h=900), g2=True)


def ahead_side():
    return (f'<div class="row sbw"><span class="d22">Who\'s ahead</span><span class="t13 b mut">Live</span></div>'
            '<div class="tabsx mt12"><span>Feed</span><span class="on">Who\'s ahead</span><span>Chat</span></div>'
            '<div class="card t mt12" style="padding:8px 12px">' + TICK + '</div>'
            '<div class="row sbw t11 mono mut mt12"><span>OWES</span><span>AHEAD</span></div>' + ahead_rows()
            + '<div class="ov mt20">If the plan ended now</div>'
            + li(av('ben', 32), 'Ben pays Maya', 'from his share', '£12.00')
            + li(av('asha', 32), 'Asha pays Maya', 'from her share', '₹676', '£6.00')
            + '<div class="sp"></div><p class="t13 mut" style="margin:0">Bars in dollars so they compare fairly; labels in each person\'s money.</p>')


item('G', '156', 'Who\'s ahead, who owes: laptop (9)',
     'On a laptop the view is a tab in the plan\'s right panel, so positions sit next to the budgets that explain them.',
     '109 → panel tab “Who\'s ahead”.', 'Row → that member\'s spends in the main column.', 'As 155.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/plan/7kq2', shell('plans', plan_main(), ahead_side(), plan='lis')), g2=True)


def onramp():
    return (f'<span class="ext">{ic("out", 12, 2.4)}External partner</span>'
            '<h3 class="d22 mt12">Add money with card or bank</h3>'
            '<p class="t15 mut" style="margin:6px 0 14px">You\'ll leave Plans and finish on Ramp Network\'s page. They handle your card or bank, not us.</p>'
            '<div class="card col8 t15">'
            '<div class="row sbw"><span class="mut">You pay</span><span class="b">£20.00</span></div>'
            '<div class="row sbw"><span class="mut">Partner fee (estimate)</span><span class="b">£0.58–£0.98</span></div>'
            '<div class="row sbw"><span class="mut">You get about</span><span class="b">$25.62–$26.16</span></div>'
            '<div class="t13 mut">Exact fee shown by Ramp Network before you pay. Plans adds nothing.</div></div>'
            '<div class="col8 mt12 t13">'
            f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("shield", 16)}</span>They may ask for ID the first time. Plans never sees your card or bank details.</div>'
            f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("clock", 16)}</span>Money usually lands in a few minutes. We\'ll tell you when it does.</div></div>'
            + '<div class="btns mt16">' + btn('Cancel', 'sec') + btn('Continue to Ramp Network', 'pri', 'out') + '</div>'
            + '<p class="t11 mut c" style="margin:10px 0 0">Not in the test version. Use Get test dollars there.</p>')


item('G', '157', 'Add money with card or bank (10)',
     'A link-out, clearly labelled: who the partner is, a fee estimate, what you\'ll get, and that you\'re leaving Plans. Nothing about card details touches Plans.',
     '09/140 → Add; 18 → Card or bank; 45b → Add money.',
     'Continue → partner page in the browser, prefilled with your Plans account and amount. Coming back → 09 with “Waiting for £20 from Ramp Network”. Cancel → back.',
     'Partner name is a placeholder until the one-hour check in research A7 confirms a link that needs no partner key. Fee range is a sample.',
     'phone', lambda t: aphone(t, SCR['09']['body'], h=SCR['09']['h'], over=app_sheet(onramp())), g2=True)


def chat():
    def bub(k, text, me=False):
        side = 'flex-direction:row-reverse;' if me else ''
        return (f'<div class="row mt8" style="{side}align-items:flex-end;gap:8px">{av(k, 28, flag=False)}'
                f'<div class="bub {"m" if me else "o"}">{text}</div></div>')
    return (ab('🌊 Lisbon chat', sub='4 people', right=ib('users'))
            + '<div class="card t" style="padding:10px 12px"><div class="row" style="gap:10px">' + f'<span class="pos">{ic("lock", 18, 2.2)}</span>'
              '<div class="lm t13"><b>Only the 4 people in this plan can read this.</b> Not even Plans. Messages are scrambled on your phone.</div></div></div>'
            + '<div class="c t11 mut mono mt12">TUE 13 OCT</div>'
            + bub('sam', 'Booked the sunset boat for Saturday 🎉')
            + bub('asha', 'I\'ll ask for the $250 from the pot')
            + f'<div class="card mt8" style="padding:10px 12px"><div class="row">{av("asha", 28, flag=False)}<div class="lm t13"><b>Asha wants $250 · Boat trip</b><div class="mut">Needs 1 more OK · Ben said OK</div></div>'
              + btn('Review', 'sec', cls='sm', style='height:34px') + '</div></div>'
            + bub('ben', 'OK\'d it. Who\'s bringing snacks? 🥙')
            + bub('maya', 'Tram passes sorted, $18 from the pot', True)
            + bub('sam', 'Pier at 5 then? 🙌')
            + bub('asha', 'Bringing pastéis for everyone 🥐')
            + bub('maya', 'Perfect. See you there!', True)
            + f'<div class="c t11 mut mt12 row" style="justify-content:center;gap:6px">{ic("key", 13, 2)}Ben has a new key · 🐙🌻🎸 · <u>compare</u></div>'
            + '<div class="sp"></div>'
            + f'<div class="row" style="gap:8px"><div class="fld" style="flex:1;min-height:48px;border-radius:999px"><div class="mut row" style="gap:8px">{ic("lock", 16, 2)}Message</div></div>'
              f'<span class="ib" style="background:var(--accent);color:var(--on-accent)">{ic("send", 20, 2)}</span></div>')


item('G', '158', 'Encrypted plan chat (11)',
     'Group talk inside the plan, with spends appearing as cards in the conversation. The lock line says plainly who can read it, and key changes are announced.',
     '16 → chat icon; 109 panel tab “Chat”; push “Sam: Booked the sunset boat…”.',
     'Review on a spend card → 27. Compare → 54 for that member. Members icon → 17.',
     'Messages are encrypted with the plan\'s group key and stored scrambled. New members see messages from when they joined. If someone\'s three pictures change, a line says so (shown).',
     'phone', lambda t: aphone(t, chat(), h=900), g2=True)

OCR = ('<div class="ocr" style="left:122px;top:338px;width:150px;height:22px"></div>'
       '<div class="ocr" style="left:122px;top:250px;width:150px;height:20px"></div>'
       '<div class="ocr" style="left:122px;top:268px;width:150px;height:14px"></div>')


def capture():
    return ('<div style="position:absolute;inset:0;overflow:hidden"><div class="vf"></div>'
            f'<div style="position:absolute;left:105px;top:240px;zoom:1.2">{PAPER}</div>' + OCR
            + '<div style="position:absolute;left:0;right:0;top:0;padding:0 8px;color:#fff">'
            + f'<div class="ab" style="margin:0"><span class="ib" style="color:#fff">{ic("x")}</span><h1 style="color:#fff">Snap a receipt</h1><span class="ib" style="color:#fff">{ic("flash")}</span></div></div>'
            + '<div class="c" style="position:absolute;left:16px;right:16px;top:560px;color:#fff">'
            + f'<span class="row" style="display:inline-flex;gap:8px;background:rgba(0,0,0,.55);border-radius:999px;padding:8px 14px;font:600 13px Figtree">{ic("phone", 16, 2)}Read on this phone · nothing is uploaded</span>'
            + '<p class="t13" style="margin:12px 0 0;opacity:.8">Found: Taberna do Bairro · €31,00 · 13 Oct</p></div>'
            + '<div style="position:absolute;left:0;right:0;bottom:36px;display:flex;justify-content:space-around;align-items:center;color:#fff">'
            + f'<span>{ic("image", 26)}</span><span style="width:72px;height:72px;border-radius:50%;border:4px solid #fff;display:grid;place-items:center"><span style="width:56px;height:56px;border-radius:50%;background:#fff"></span></span><span style="width:26px"></span></div></div>')


item('G', '159', 'Snap a receipt: camera (12)',
     'The camera reads the receipt on the phone itself. Found fields are outlined live, and a line says nothing is uploaded.',
     '21 → Add receipt photo → Snap; 16 ⋯ → I paid for something → Snap.',
     'Shutter → 160 with fields filled in. Gallery → pick a photo, same reading.',
     'Always dark (camera). Nothing found: “Couldn\'t read this one. You can still attach it and type the amount.”',
     'phone', lambda t: aphone(t, capture(), scr='cam'), g2=True)


def read_mark():
    return f'<span class="chip sm acc" style="height:22px;font-size:11px">{ic("sparkle", 12, 2.4)}Read</span>'


def confirm_read():
    return (ab('Check what we read', sub='Pay from Lisbon pot')
            + f'<div class="row"><span class="thumb" style="width:72px;height:72px"><i></i></span><div class="lm"><div class="lt">Receipt photo</div>'
              f'<div class="t13 mut row" style="gap:6px">{ic("lock", 13, 2.2)}Stays on this phone until you pay</div></div></div>'
            + '<div class="col mt16">'
            + field('Where', 'Taberna do Bairro', right=read_mark())
            + field('Amount', '€31.00 <span class="m2">· $36.02</span>', right=read_mark())
            + field('When', 'Tue 13 Oct · 21:40', right=read_mark())
            + field('Category', '🍽️ Food &amp; drink', right='<span class="chip sm">Suggested</span>')
            + '</div>'
            + '<div class="mt12">' + bn('pos', 'phone', 'The photo never left your phone', 'We read it here. When you pay, it\'s scrambled so only the plan can open it.') + '</div>'
            + '<div class="sp"></div>' + btn('Looks right · continue') + btn('Type it myself', 'txt', cls='mt4'))


item('G', '160', 'Snap a receipt: check the fields (12)',
     'Every filled field is marked “Read” so people know to check it. Category is a suggestion, not a guess passed off as fact.',
     '159 → shutter.', 'Looks right → 21 with payee, amount, note and photo filled in; the rule preview runs as usual. Type it myself → 21 empty with the photo attached.',
     'Euros are converted at the reference rate shown on 21. A field that couldn\'t be read is left empty with “Couldn\'t read”.',
     'phone', lambda t: aphone(t, confirm_read(), h=900), g2=True)


def biz_lap():
    form = ('<div style="width:480px"><span class="chip sm ol mono" style="font-size:11px">FOR BUSINESSES</span>'
            '<h1 class="d44 mt12">Ask a group to pay</h1><p class="t17 mut" style="margin:8px 0 20px">Type the amount, show the code. The group pays from its pot, under its own rules.</p>'
            '<div class="col">' + field('Business name', 'Sunset Boats Lisboa') + field('Amount', '€215.17<span class="caret"></span>', 'on', right='<span class="mono" style="color:var(--ink)">$250.00</span>')
            + field('What it\'s for (optional)', 'Sunset boat · Sat 17:00 · 4 people') + '</div>'
            '<div class="row mt12 t13 mut" style="gap:8px">' + ic('ticket', 16) + 'Paid into: Plans account of Sunset Boats Lisboa (you)</div>'
            + '<div class="mt16" style="width:260px">' + btn('Update code', 'sec', 'refresh') + '</div></div>')
    code = ('<div class="mc" style="width:420px;padding:28px;text-align:center">'
            '<div class="ov">Show this to the group</div>'
            f'<div style="display:inline-block;padding:12px;background:#fff;border-radius:18px;margin-top:14px">{qr("biz", 240, center=QR_LOGO)}</div>'
            '<div class="d34 mt16">€215.17</div><div class="t15 mut">$250.00 · Sunset Boats Lisboa</div>'
            '<div class="row mt16" style="justify-content:center;gap:8px"><span class="mono t13">plans.0xo.in/b/sunset-7f3</span>' + btn('Copy link', 'sec', 'copy', 'sm') + '</div>'
            f'<div class="card t mt16 row" style="padding:10px 14px;justify-content:center;gap:8px"><span class="dot" style="background:var(--info);box-shadow:0 0 0 4px color-mix(in srgb,var(--info) 25%,transparent)"></span><span class="t15 b">Waiting for the group</span></div>'
            '<p class="t13 mut" style="margin:10px 0 0">Bigger amounts may need the group\'s OK first. We show a tick here the moment it\'s paid.</p></div>')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{site_top(btn("Sunset Boats Lisboa", "sec", "store", "sm"))}'
            f'<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:80px;padding:0 48px">{form}{code}</div></div>')


item('G', '161', 'Business payment request page (13)',
     'A web page for a venue: type the amount and a name, get a QR and a link. The group pays from its pot, under its rules, and the page shows when it\'s paid.',
     'plans.0xo.in/business, with the business\'s own Plans account (passkey, like anyone).',
     'Group member scans → 162. Paid → the waiting line turns into “Paid €215.17 from a Plans group · 17:02” with Proof.',
     'Needs approval: “Waiting for the group\'s OK (2 of 3)”. Expired after 30 min: “Make a new code”. The business never sees who\'s in the group.',
     'lap', lambda t: lap(t, 'plans.0xo.in/business', biz_lap()), g2=True)


def biz_pay():
    return (ab('Pay Sunset Boats Lisboa', sub='From Lisbon pot', icon='x')
            + f'<div class="card"><div class="row">{emo("⛵", W["lagoon"], 48)}<div class="lm"><div class="lt">Sunset Boats Lisboa</div>'
              '<div class="t13 mut">Business · Plans code · asked 16:58</div></div></div>'
              '<div class="t15 mt12">“Sunset boat · Sat 17:00 · 4 people”</div></div>'
            + '<div class="c mt20"><div class="d56">$250.00</div><div class="t17 m2 mt4">€215.17 · £185.57</div></div>'
            + '<div class="ov mt20">Category</div><div class="wrapc mt8">' + chip('🎟️ Tickets &amp; activities', 'on') + chip('✨ Other') + '</div>'
            + f'<div class="row mt12 t13">{avs(["maya", "sam", "asha", "ben"], 24)}<span class="mut">Everyone · <b style="color:var(--ink)">$62.50 each</b></span></div>'
            + '<div class="sp"></div>'
            + bn('inf', 'users', 'Needs 2 more OKs', 'Over $200 needs 3 of 4. We\'ll ask Sam, Asha and Ben. The boat is paid the moment the second says yes.')
            + '<div class="dock mt12">' + btn('Ask for OKs', 'pri', 'send') + '</div>')


item('G', '162', 'Paying a business code from the pot (13)',
     'What a member sees after scanning the venue\'s code: the request, the amount in three currencies, and the rule preview. The group\'s rules decide, not the person holding the phone.',
     '44 (scan) → a business code; or the business link opened on a phone.',
     'Ask for OKs → 16 with a waiting item; others get 27. Under $25 → “Goes through now” and Confirm with fingerprint.',
     'Business payee switched off in the rules: “This plan can\'t pay businesses. Ask the group to change it.” Over budget: 22b pattern.',
     'phone', lambda t: aphone(t, biz_pay(), h=900), g2=True)


# ================================================================== H. Landing note
def landing_map(theme):
    def blk(label, h, slot='', note=''):
        if slot:
            return (f'<div class="slot" style="height:{h}px;margin-top:22px"><span class="sl">Pro · {slot}</span>'
                    f'<div class="lt">{label}</div><div class="t13 mut">{note}</div></div>')
        return f'<div class="wire" style="height:{h}px;margin-top:12px;justify-items:start;text-align:left;padding:14px 18px"><span>{label}</span></div>'
    col = ('<div style="width:620px">'
           + '<div class="mc" style="padding:18px 20px;border:2px solid var(--ink)"><div class="ov">Hero</div><div class="d22 mt4">A shared pot for every plan, wherever your friends live.</div>'
             '<div class="row mt12" style="gap:8px">' + btn('Get the Android app · Test version', 'pri', cls='sm') + btn('Use Plans in your browser', 'sec', cls='sm') + '</div></div>'
           + blk('Departures board (built, not Pro)', 46)
           + blk('#how · From the group chat to settled, in four steps', 92, 'Feature Sections', 'Feed FEATURE_STEPS. Keep id “how” and the heading copy.')
           + blk('#rules · Rules your group sets, kept by the pot itself', 92, 'Bento Grids', 'Cells from RULES_CELLS. Keep id “rules”.')
           + blk('#borders · Across borders (built)', 46)
           + blk('#numbers · Built on Monad, measured, not promised', 92, 'Stats Sections', 'MEASURED (fixed) + live testnet numbers from Envio, labelled “Testnet”.')
           + blk('Privacy · FAQ (built)', 46)
           + blk('#get · Start a plan before the group chat goes quiet', 92, 'CTA Sections', 'Primary → /download; secondary → Use Plans in your browser.')
           + '</div>')
    notes = ('<div style="width:600px">'
             '<div class="ov">Landing page · where the four Pro blocks go</div>'
             '<h2 class="d34 mt8">Four slots, already marked in the code</h2>'
             '<p class="t15 mut" style="margin:8px 0 16px">Each slot is a comment at the top of its component (FeatureSection, RulesBento, StatsSection, FinalCta). No Pro code is in this proposal; only where it goes and what it must keep.</p>'
             '<div class="mc"><div class="lt">Hero call to action, corrected</div>'
             '<div class="col8 mt8 t15">'
             f'<div class="row" style="gap:10px;align-items:flex-start"><span class="neg">{ic("x", 18, 2.6)}</span><span><s>Get the Android app · Beta · 12 Oct</s></span></div>'
             f'<div class="row" style="gap:10px;align-items:flex-start"><span class="pos">{ic("check", 18, 2.6)}</span><span><b>Get the Android app · Test version</b> once release.json is “live”</span></div>'
             f'<div class="row" style="gap:10px;align-items:flex-start"><span class="pos">{ic("check", 18, 2.6)}</span><span><b>Get the Android app · Coming soon</b> until then</span></div>'
             f'<div class="row" style="gap:10px;align-items:flex-start"><span class="pos">{ic("check", 18, 2.6)}</span><span><b>Use Plans in your browser</b> as the second button, always</span></div></div>'
             '<p class="t13 mut" style="margin:10px 0 0">Under the buttons: “Test version available now · free test dollars”, shown only when live. No dates we can\'t keep.</p></div>'
             '<div class="mc mt12"><div class="lt">Rules for every Pro block</div><ul class="t15" style="margin:8px 0 0;padding-left:20px">'
             '<li>Our colours, fonts and copy; no stock gradients or glow.</li><li>Keep the section ids (nav anchors).</li>'
             '<li>Respect reduced motion; nothing loops.</li><li>Stats show a dash, never an estimate.</li></ul></div></div>')
    return (f'<div class="lap fx {theme}" style="height:880px"><div class="vp" style="padding:40px 56px;gap:64px;justify-content:center">{col}{notes}</div></div>')


section('H', 'Landing page note', 'Where the four Aceternity Pro blocks go, and hero copy that states only what\'s true.')

item('H', '163', 'Landing page: Pro block slots and corrected CTA',
     'A page map of plans.0xo.in with the four Pro slots marked in marigold, and the corrected hero call to action. This is placement only; the Pro code comes after Aceternity access is confirmed.',
     '', '', 'Desktop hero with the QR card is 131; phone hero is 164.',
     ('w', 1440, 1), landing_map)


def hero_phone():
    return (f'<div class="webtop">{logo(20)}' + btn('Get the app', 'pri', cls='sm', style='height:36px') + '</div>'
            + '<div class="c mt12">' + flags_pill().replace('Friends in four countries, one pot', 'Four countries, one pot') + '</div>'
            + '<h1 class="d44 c mt16" style="font-size:42px">A shared pot for every plan, wherever your <span style="background:linear-gradient(transparent 62%,var(--accent) 62% 92%,transparent 92%)">friends</span> live.</h1>'
            + '<p class="t17 mut c" style="margin:14px 4px 22px">Join with one fingerprint. Spend from the pot under rules the group agrees on. Settle up in one tap, in pounds, dollars or rupees.</p>'
            + btn('Get the Android app <span class="chip sm" style="height:24px;background:rgba(16,35,27,.12);color:#10231B">Test version</span>', 'pri')
            + btn('Use Plans in your browser', 'sec', cls='mt8')
            + '<p class="mono t13 mut c" style="margin:16px 0 0">Test version available now · free test dollars</p>'
            + '<div class="sp"></div><p class="mono t11 mut c" style="margin:0">No bank account in common. No app password. Free for groups.</p>')


item('H', '164', 'Hero on a phone, corrected',
     'The phone hero with the claim removed: “Test version” on the button (only once published), the browser as a second way in, and one true line underneath.',
     'plans.0xo.in on a phone.', 'Get the Android app → 132. Use Plans in your browser → 01 (web).',
     'Before publishing: tag reads “Coming soon” and the line under the buttons is hidden.',
     'phone', lambda t: mphone(t, hero_phone(), url='plans.0xo.in'))
