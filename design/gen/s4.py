from base import *
from s2 import plan_home, plan_top, LIS
from s3 import SPIN

AUSD = f'<span class="pill">Digital dollars (AUSD){ic("info", 14, 2)}</span>'
RATE = '<div class="mono t11 mut">Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC</div>'

def big3(items):
    return '<div class="big3">' + ''.join(f'<div class="{c}">{tile(i, t)}<span>{l}</span></div>' for i, t, l, c in items) + '</div>'

# ------------------------------------------------------------------ K. Send
add('K', '43', 'Send home',
    'Money to a person, anywhere. Balance first, three ways to send, then the people you send to most.',
    'Send tab; Home → Send; 09 → Send.',
    'Recent person → 45. Scan code → 44. Send by link → 50. My code → 49.',
    'Empty (no one sent to yet): recent list becomes "Scan a friend\'s code to start". Balance $0: amount screen leads with Add money.',
    f'<div class="row sbw" style="min-height:72px"><div class="d28">Send</div>{ib("qr")}</div>'
    + '<div class="card"><div class="ov">You can send</div>'
      '<div class="hero mt4"><span class="d34">$5.00</span><span class="t17 m2">£3.71</span></div>'
      f'<div class="mt8">{AUSD}</div></div>'
    + '<div class="mt12">' + big3([('scan', 'a', 'Scan code', 'hi'), ('link', '', 'Send by link', ''), ('qr', '', 'My code', '')]) + '</div>'
    + '<div class="mt12">' + field('', f'<span class="mut row" style="gap:8px">{ic("search", 20)}Name, Plans code or phone</span>') + '</div>'
    + '<div class="sec-h"><span class="d17">Recent</span><a>See all</a></div>'
    + li(av('sam', 44), 'Sam', 'New York · gets dollars', ic('chev', 20))
    + li(av('asha', 44), 'Asha', 'Bengaluru · gets rupees', ic('chev', 20))
    + li(av('ben', 44), 'Ben', 'Manchester · gets pounds', ic('chev', 20))
    + '<div class="sp"></div>' + bn('pos', 'zap', 'Free and instant', 'To anyone on Plans, in any country. Usually under a second.'),
    tab='send', h=900)

CORN = ''.join(f'<span class="vfc" style="{s}"></span>' for s in [
    'left:75px;top:230px;border-right:0;border-bottom:0;border-radius:18px 0 0 0',
    'right:75px;top:230px;border-left:0;border-bottom:0;border-radius:0 18px 0 0',
    'left:75px;top:470px;border-right:0;border-top:0;border-radius:0 0 0 18px',
    'right:75px;top:470px;border-left:0;border-top:0;border-radius:0 0 18px 0'])

add('K', '44', 'Scan a Plans code',
    'Camera opens straight into scanning. When it sees a code it names the person before you go on.',
    '43 → Scan code; Home → Receive → Scan; 20 → Scan a business.',
    'Code recognised → chip → tap → 45 with the person filled in. Show my code → 49.',
    'Always dark (it is a camera). No camera permission: plain screen with "Allow camera" button. Not a Plans code: "That code isn\'t a Plans code".',
    '<div style="position:absolute;inset:0;overflow:hidden"><div class="vf"></div>'
    '<div style="position:absolute;left:95px;top:250px;width:200px;height:240px;border-radius:22px;background:#1b1f1d;transform:rotate(-4deg);'
    'box-shadow:0 20px 40px rgba(0,0,0,.5);display:grid;place-items:center;padding:16px">'
    + qr('sam', 160, center='<span class="av" style="--c:#3C78B8;--s:28px">S</span>') + '</div>'
    + CORN
    + '<div style="position:absolute;left:0;right:0;top:0;padding:0 8px;color:#fff">'
    + f'<div class="ab" style="margin:0"><span class="ib" style="color:#fff">{ic("x")}</span><h1 style="color:#fff">Scan a Plans code</h1><span class="ib" style="color:#fff">{ic("torch")}</span></div></div>'
    + '<div class="c" style="position:absolute;left:16px;right:16px;top:540px;color:#fff">'
    + '<span class="row" style="display:inline-flex;gap:10px;background:#fff;color:#10231B;border-radius:999px;padding:6px 16px 6px 6px;font-weight:600">'
    + av('sam', 36) + 'Sam · New York' + ic('chev', 18, 2.4) + '</span>'
    + '<p class="t13" style="margin:14px 0 0;opacity:.75">Point at a friend\'s Plans code</p></div>'
    + '<div style="position:absolute;left:16px;right:16px;bottom:24px">'
    + '<span class="btn" style="background:rgba(255,255,255,.14);color:#fff">' + ic('qr', 22, 2) + 'Show my code</span></div></div>',
    scr='cam')

def amount_screen(local, gets, extra, cta, h=900):
    return (ab('Send to Sam', sub='New York · gets dollars', right=f'<span style="margin-right:8px">{av("sam", 36)}</span>')
            + f'<div class="c mt16"><div class="d56">{local}<span style="display:inline-block;width:3px;height:48px;background:var(--accent);vertical-align:-6px;margin-left:2px"></span></div>'
            f'<div class="mt8" style="font-size:21px">{gets}</div><div class="mt8">{RATE}</div>'
            f'<span class="chip sm ol mt12">{ic("swap", 14, 2)}Type in dollars</span></div>'
            + extra + '<div class="sp"></div>' + kp() + cta)

BAL_ROW = ('<div class="card t mt20"><div class="row sbw"><div><div class="t13 mut">You have</div><div class="b">$5.00 · £3.71</div></div>'
           + AUSD + '</div></div>')

add('K', '45', 'Amount',
    'Type in your own money; see exactly what the other person gets in theirs, with the reference rate.',
    '43 recent person; 44 scan; Plans code link.',
    'Continue → 46. Back → 43.',
    'Live conversion as you type. Max two decimals. Type-in-dollars swaps the big number. Too much → 45b.',
    amount_screen('£1.50', 'Sam gets <b>$2.02</b>',
                  BAL_ROW + '<div class="row mt8" style="justify-content:center"><span class="chip sm pos">' + ic('zap', 14, 2.2) + 'No fee · arrives in under a second</span></div>',
                  btn('Continue', cls='mt8')))

add('K', '45b', 'Amount: not enough',
    'Added state. Says what you have and offers the fix, without an error tone on the number itself.',
    '45 when the amount is more than your balance.',
    'Add money → 09 add options (55 on the test version). Lowering the amount clears the message.',
    'The conversion line stays visible so people can pick a smaller amount that works.',
    amount_screen('£5.00', 'Sam would get <b>$6.74</b>',
                  '<div class="mt20">' + bn('neg', 'alert', 'That\'s more than you have', 'You have $5.00 · £3.71. Send less, or add money first.') + '</div>',
                  '<div class="btns mt8">' + btn('Add money', 'sec', 'plus') + btn('Continue', 'off') + '</div>'))

CONFIRM = (ab('Check and send')
    + f'<div class="row mt8" style="justify-content:center;gap:16px">{av("maya", 56)}<span class="mut">{ic("chev", 28, 2)}</span>{av("sam", 56)}</div>'
    + '<div class="c mt16"><div class="d44">£1.50</div><div class="t17 mt8">Sam gets <b>$2.02</b> in New York</div></div>'
    + '<div class="card mt20 col8 t15">'
    + '<div class="row sbw"><span class="mut">To</span><span class="b">Sam · New York</span></div>'
    + '<div class="row sbw"><span class="mut">You send</span><span class="b">£1.50</span></div>'
    + '<div class="row sbw"><span class="mut">Sam gets</span><span class="b">$2.02</span></div>'
    + '<div class="row sbw"><span class="mut">Fee</span><span class="b">$0.00</span></div>'
    + '<div class="row sbw"><span class="mut">Note</span><span class="b">Coffee ☕</span></div>'
    + RATE + '</div>'
    + '<div class="sp"></div>' + btn('Confirm with fingerprint', 'pri', 'fp'))

add('K', '46', 'Confirm with fingerprint',
    'One last check, then the system passkey sheet. No PIN of our own, no extra codes.',
    '45 → Continue → Confirm with fingerprint.',
    'Fingerprint → 47 (under a second). Cancel → back to the check screen, nothing sent.',
    'The sheet is Android\'s, using Google Password Manager wording. Rate is locked for 60 s; after that the check screen refreshes it and says so.',
    CONFIRM, over=sys_sheet('use'))

add('K', '47', 'Sent receipt',
    'The receipt for the payments video: both currencies, the rate, the measured time, and Proof.',
    '46 after fingerprint.',
    'Done → 43. Share → image of the stub. Proof → public record in the browser.',
    'If it takes over 5 s: "Still sending…" and the stub waits. Failure → 59, with "Your money didn\'t move".',
    f'<div class="c mt16"><div class="bigic p">{ic("check", 36, 2.4)}</div><h2 class="d34 mt12">Sent</h2>'
    '<p class="t15 mut" style="margin:6px 16px 20px">Sam got $2.02 in New York.</p></div>'
    + stub('<div class="row sbw"><span class="ov">Plans · sent</span><span class="t13 mut mono">#7Q2-1405</span></div>'
           f'<div class="row mt8" style="gap:10px"><span class="d34">£1.50</span><span class="mut">{ic("chev", 22, 2.4)}</span><span class="d34">$2.02</span></div>',
           [('From', 'Maya · London 🇬🇧'), ('To', 'Sam · New York 🇺🇸'), ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC'),
            ('Fee', '$0.00'), ('Note', 'Coffee ☕'), ('When', 'Tue 13 Oct · 14:05:12')],
           f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}')
    + '<div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Done') + '</div>')

add('K', '48', 'Received',
    'The other side, on Sam\'s phone. Who, where from, how much in his money, and what was sent.',
    'Push "+$2.02 from Maya, London"; Activity.',
    'Say thanks → sends a 👋 reaction. Send back → 45 with Maya. Done → 43.',
    'Shown as a sheet if the app is open; full screen from the push. Balance animates up.',
    f'<div class="c mt32"><div style="display:inline-block">{av("maya", 80)}</div>'
    '<div class="d56 pos mt20">+$2.02</div><div class="t17 mt8">from <b>Maya, London</b></div>'
    '<div class="t13 mut mt4">Maya sent £1.50 · “Coffee ☕”</div></div>'
    + '<div class="mt24">' + stub('<div class="row sbw"><span class="ov">Plans · received</span><span class="t13 mut mono">#7Q2-1405</span></div>',
           [('From', 'Maya · London 🇬🇧 · £1.50'), ('To', 'You · New York · $2.02'), ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC'), ('When', 'Tue 13 Oct · 09:05:12 EDT')],
           f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}') + '</div>'
    + '<div class="card t mt12 row sbw"><span class="t13 mut">Your Plans account</span><span class="b">$47.02</span></div>'
    + '<div class="sp"></div><div class="btns">' + btn('Say thanks 👋', 'sec') + btn('Done') + '</div>')

MAYA_QR = qr('maya', 232, center='<span class="av" style="--c:#D9634B;--s:36px">M</span>')

add('K', '49', 'My Plans code',
    'Your code to receive money. Big, scannable, with your name and country so the sender knows it\'s you.',
    '43 → My code; Home → Receive; 44 → Show my code.',
    'Share / Copy link. Ask for an amount → number pad, then the code carries that amount.',
    'Brightness goes up while this is open. The code only lets people send to you; it says so.',
    ab('My Plans code', icon='x', right=ib('share'))
    + '<div class="card c mt8" style="padding:24px 16px 20px">'
    + f'<div style="display:inline-block">{av("maya", 56)}</div><div class="d22 mt8">Maya</div><div class="t13 mut">London · gets pounds</div>'
    + f'<div style="display:inline-block;padding:12px;border-radius:20px;background:#fff;margin-top:16px">{MAYA_QR}</div>'
    + '<div class="mono t13 mt12">plans.0xo.in/@maya-7q2</div></div>'
    + f'<div class="row mt12" style="justify-content:center"><span class="chip ol">{ic("plus", 16, 2.2)}Ask for an amount</span></div>'
    + '<p class="t13 mut c" style="margin:12px 16px 0">Anyone can scan this to send you money. It can\'t be used to take money.</p>'
    + '<div class="sp"></div><div class="btns">' + btn('Copy link', 'sec', 'copy') + btn('Share', 'pri', 'share') + '</div>')

add('K', '50', 'Send by link',
    'For someone not on Plans yet. Amount, a note, how long the link works, then share.',
    '43 → Send by link.',
    'Confirm with fingerprint → share sheet with the link → Activity shows "Link sent · not claimed".',
    'Unclaimed money comes back by itself at expiry. You can cancel any time before it\'s claimed.',
    ab('Send by link', icon='x')
    + '<div class="c mt8"><div class="d56">$25.00</div><div class="t17 m2 mt4">£18.56</div>'
      '<p class="t13 mut" style="margin:8px 24px 0">They pick how to get it: dollars, or their own money.</p></div>'
    + '<div class="mt20">' + field('Note', 'For the train tickets 🚆') + '</div>'
    + f'<div class="ov mt20">Link works for</div><div class="row mt8" style="gap:8px">{chip("24 hours")}{chip("7 days", "on")}{chip("30 days")}</div>'
    + '<div class="mt16">' + bn('acc', 'link', 'Anyone with the link can claim it', 'Send it to one person only. If no one claims it, the $25 comes back to you.') + '</div>'
    + '<div class="sp"></div><div class="dock mt16">' + btn('Confirm with fingerprint', 'pri', 'fp') + '</div>')

add('K', '51', 'Claim a link',
    'What the recipient sees on opening the link: who sent it, how much in their money, and one button.',
    'Link from 50, opened on a phone (app installed, or after install from the store).',
    'Create account & claim → 02 → 03 → money lands → 09. Already use Plans → 04 → claimed.',
    'Expired: "This link ran out. The money went back to Maya." Already claimed: "Someone already claimed this." Neither shows an amount.',
    f'<div class="row sbw" style="height:56px">{logo(20)}<span class="chip sm ol">English</span></div>'
    + stub(f'<div class="row">{av("maya", 44)}<div><div class="lt">Maya sent you</div><div class="t13 mut">London 🇬🇧</div></div></div>'
           '<div class="mt16"><span class="d56">$25</span> <span class="d22 m2">(≈ ₹2,090)</span></div>'
           '<p class="t15" style="margin:10px 0 0">“For the train tickets 🚆”</p>',
           [('Expires', 'Tue 20 Oct · 6 days left'), ('Fee', 'None')])
    + '<h2 class="d22 mt24">Claim it in a minute</h2><div class="col mt12">'
    + '<div class="step"><span class="n">1</span><div>Create your Plans account with your fingerprint.</div></div>'
    + '<div class="step"><span class="n">2</span><div>The money lands straight away.</div></div>'
    + '<div class="step"><span class="n">3</span><div>Keep it as dollars, or send it on to anyone.</div></div></div>'
    + '<p class="t13 mut" style="margin:12px 0 0">No bank details needed.</p>'
    + '<div class="sp"></div>' + btn('Create account &amp; claim', 'pri', 'fp') + btn('I already use Plans', 'sec', cls='mt8'), h=900)

# ------------------------------------------------------------------ L. Activity & You
add('L', '52', 'Activity',
    'Everything that happened, with what needs you pinned on top and actionable in place.',
    'Activity tab (red dot when something needs you); push notifications land here too.',
    'Approve / Reject → 27 flow in place. Vote → 35. Rows → their detail (29, 47, 40, 42).',
    'Empty: "All quiet. Spends, money in and settle-ups show up here." Filters keep their own empty states.',
    f'<div class="row sbw" style="min-height:72px"><div class="d28">Activity</div>{ib("sliders")}</div>'
    + f'<div class="row" style="gap:8px">{chip("All", "on")}{chip("Needs you · 2")}{chip("Money")}{chip("Plans")}</div>'
    + '<div class="ov mt20">Needs you</div>'
    + f'<div class="card mt8"><div class="row" style="align-items:flex-start">{av("asha", 40)}<div class="lm"><div class="lt">Asha wants $250 for the boat trip</div>'
      '<div class="t13 mut">Lisbon · Ben said OK · 22 h left</div></div></div>'
      '<div class="btns mt12">' + btn('Reject', 'out', cls='sm') + btn('Approve', 'pri', cls='sm') + '</div></div>'
    + f'<div class="card mt8"><div class="row">{av("ben", 40)}<div class="lm"><div class="lt">Ben suggests a rule change</div>'
      '<div class="t13 mut">Lisbon · Food budget $120 → $180</div></div>' + btn('Vote', 'sec', cls='sm') + '</div></div>'
    + '<div class="ov mt20">Today</div>'
    + li(tile('out'), 'You sent £1.50 to Sam', 'Sam got $2.02 · 14:05', '−£1.50', '')
    + li(av('sam', 40), 'Sam paid $36 · Dinner at Taberna', 'Lisbon · your share £8.91', '', '21:40')
    + li(tile('in', 'p'), 'You added £20 to Lisbon', 'The pot got $26.94', '', '09:12')
    + '<div class="ov mt16">Earlier</div>'
    + li(emo('🎪', W['orchid'], 40), 'Glastonbury crew is settled', '<span class="neg b">You owe Ben £8.91 · Pay now</span>', '', '28 Jun'),
    tab='act', h=960)

add('L', '53', 'You',
    'Profile and settings, kept short. The key fingerprint is shown here so people can compare it across phones.',
    'You tab.',
    'Key pill → 54. Country & money → picker. Phones → list with "Remove". Sign out → confirm sheet.',
    'Test version adds "Get test dollars" (55) above Help. Sign out warns that receipts reopen when you come back with the same passkey.',
    f'<div class="c mt16"><div style="display:inline-block">{av("maya", 80)}</div><h2 class="d28 mt12">Maya</h2>'
    '<div class="t13 mut">London, United Kingdom · shows £ GBP</div></div>'
    + f'<div class="card mt16"><div class="row sbw">{fp()}{ic("chev", 20)}</div><p class="t13 mut" style="margin:8px 0 0">Your key fingerprint. The same on every phone you sign in to.</p></div>'
    + '<div class="mt8">'
    + li(tile('globe'), 'Country &amp; money', 'United Kingdom · £ GBP', ic('chev', 20))
    + li(tile('ticket'), 'Your Plans account', '$5.00 · £3.71', ic('chev', 20))
    + li(tile('bell'), 'Notifications', 'Approvals, money in, settle-ups', ic('chev', 20))
    + li(tile('phone'), 'Phones with your passkey', 'Pixel 8 (this one) · Galaxy Tab', ic('chev', 20))
    + li(tile('gift', 'a'), 'Get test dollars', 'Test version only', ic('chev', 20))
    + li(tile('help'), 'Help', '', ic('chev', 20))
    + li(tile('info'), 'About Plans', 'Version 1.0 · Test version', ic('chev', 20))
    + li(tile('logout', 'n'), '<span class="neg">Sign out</span>', '')
    + '</div>', tab='you', h=1000)

def why(icon, t):
    return f'<div class="row" style="align-items:flex-start;gap:14px"><span class="tl">{ic(icon, 20)}</span><p class="t15" style="margin:2px 0 0">{t}</p></div>'

add('L', '54', 'Your key',
    'Explains, in plain words, why receipts are private and what the three pictures mean.',
    '53 → key pill; 05 restore.',
    'Got it → 53.',
    'If a friend\'s pictures change, their row in 17 shows "New key · 2 h ago" with a link here.',
    ab('Your key')
    + '<div class="c mt8"><div class="ov">Key fingerprint</div>'
      '<div class="mt12" style="display:inline-flex;gap:14px;padding:14px 22px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:44px;line-height:1">🦊<span>🌵</span>🎈</div></div>'
    + '<h2 class="d22 mt24">Your receipts are locked to your plans</h2>'
    + '<div class="col mt16" style="gap:16px">'
    + why('lock', 'Receipt photos and notes are scrambled before they leave your phone. Only people in that plan can open them.')
    + why('key', 'Your key comes from your passkey. Use Plans on a new phone and you get the same key, so nothing is lost.')
    + why('eye', 'Plans can\'t see your photos or notes. Neither can anyone outside the plan.')
    + why('users', 'The three pictures are a short name for your key. Friends see the same three next to your name. If they change and you didn\'t get a new phone, tell us.')
    + '</div>'
    + f'<div class="card t mt20"><div class="ov">How friends see you</div><div class="row mt8">{av("maya", 36)}<span class="lt lm">Maya</span><span class="pill" style="font-size:15px;letter-spacing:3px">🦊🌵🎈</span></div></div>'
    + '<div class="sp"></div>' + btn('Got it', 'sec', cls='mt16'), h=900)

add('L', '55', 'Get test dollars',
    'Test version only. Free test money so anyone can try Plans, labelled so no one mistakes it for real money.',
    '53 → Get test dollars; Add money in the test version (09, 18, 45b).',
    'Get → balance animates → back to where you came from.',
    'Once a day per account: after use the button reads "Next top-up in 23 h". The striped test band appears here and on Add money only.',
    '<div class="testrib">Test version · not real money</div>'
    + ab('Get test dollars')
    + f'<div class="c mt8"><div class="bigic a">{ic("gift", 34, 2)}</div><h2 class="d28 mt16">Get $50 to try Plans</h2>'
    '<p class="t15 mut" style="margin:8px 12px 0">Test dollars work like real ones in this version. They have no value and can\'t be cashed out.</p></div>'
    + '<div class="card mt24 col8 t15">'
    + '<div class="row sbw"><span class="mut">Your Plans account now</span><span class="b">$5.00 · £3.71</span></div>'
    + '<div class="row sbw"><span class="mut">After</span><span class="b pos">$55.00 · £40.83</span></div></div>'
    + f'<p class="t13 mut row" style="margin:12px 0 0;gap:6px">{ic("clock", 16)}One top-up a day for each account.</p>'
    + '<div class="sp"></div>' + btn('Get $50 test dollars', 'pri', 'gift'))

# ------------------------------------------------------------------ M. Judge demo
def dname(k):
    return f'{P[k]["n"]}{demo()}'

add('M', '56', 'Try a settle-up: intro',
    'For judges and the curious: a guided 2-minute plan with three demo friends, clearly labelled. Shown for Kai in Berlin (euros).',
    'Home card "Try a settle-up" (07, 08); You → Help.',
    'Start the demo → 57. Close → home; the card stays until dismissed.',
    'Demo friends are run by Plans and always carry a Demo chip. The demo uses test dollars and can be run again.',
    ab('', icon='x')
    + f'<div class="band" style="--w:{W["coral"]};position:relative;width:auto;margin:8px -40px 0;transform:rotate(-3deg);justify-content:center"><span>DEMO · PORTO WEEKEND · 2 MIN</span><i></i></div>'
    + '<h2 class="d34 mt24">Try a settle-up in 2 minutes</h2>'
    + '<p class="t15 mut" style="margin:8px 0 16px">We\'ll make a plan with three demo friends. They\'re run by Plans, not real people. Watch them spend, see one approve, then settle up in one tap.</p>'
    + '<div class="card" style="padding-top:4px;padding-bottom:4px">'
    + li(av('ben', 40), dname('ben'), 'Manchester · gets pounds') + li(av('asha', 40), dname('asha'), 'Bengaluru · gets rupees')
    + li(av('maya', 40), dname('maya'), 'London · gets pounds') + '</div>'
    + '<div class="col mt16">'
    + '<div class="step"><span class="n">1</span><div>They spend from the pot. You see it live.</div></div>'
    + '<div class="step"><span class="n">2</span><div>Ben approves a bigger spend.</div></div>'
    + '<div class="step"><span class="n">3</span><div>You end the plan and settle up.</div></div></div>'
    + '<div class="mt16">' + bn('acc', 'gift', 'Uses test dollars', 'Nothing real moves. We put $20 (€17.21) in the pot for you.') + '</div>'
    + '<div class="sp"></div>' + btn('Start the demo', 'pri', 'play', 'mt16'), h=930)

add('M', '57', 'Demo plan running',
    'The demo friends act on their own. A step bar says where you are and what comes next.',
    '56 → Start the demo.',
    'End plan & settle up → 37 → 38 → 40 (demo friends agree within 2 s). Leave demo → home; it can be resumed.',
    'Ben · Demo grants the approval automatically 3 s after the request. Every demo row carries the Demo chip; receipts say "Demo".',
    ab(f'<span>🎡 Porto weekend{demo()}</span>', right=ib('more')) + '<div class="bleed">' + wb(W['coral'], 'Demo · step 2 of 3 · 4 people') + '</div>'
    + '<div class="card mt12"><div class="row sbw t13"><span class="b">Step 2 of 3 · Ben approves a bigger spend</span><span class="mut">1:10</span></div>'
      '<div class="bar mt8"><i style="width:66%;background:var(--accent)"></i></div></div>'
    + '<div class="card mt12"><div class="ov">In the pot</div><div class="hero mt4"><span class="d34">$68.00</span><span class="t17 m2">€58.52</span></div></div>'
    + '<div class="sec-h"><span class="d17 row" style="gap:10px"><span class="dot"></span>Live</span></div><div class="feed">'
    + li(av('maya', 36), f'{dname("maya")} wants $60 · Wine tasting',
         f'<span class="pos b">{P["ben"]["n"]}{demo()} said OK · paid</span>', '<span class="chip sm pos">Approved</span>', '', ' new')
    + li(av('asha', 36), f'{dname("asha")} paid $24 · Pastéis for everyone', 'Food &amp; drink · split 4', '', '1 min')
    + li(av('ben', 36), f'{dname("ben")} paid $18 · Train to Porto', 'Transport · split 4', '', '2 min')
    + li(tile('in', 'p'), 'You added $20', '€17.21 · test dollars', '', '2 min')
    + '</div>'
    + '<div class="card t mt12"><div class="lt">Next: end the plan</div><div class="t13 mut">Everyone is paid at once, in their own money.</div></div>'
    + '<div class="dock mt16">' + btn('End plan &amp; settle up', 'pri', 'check') + '</div>', h=960)

# ------------------------------------------------------------------ N. System
add('N', '58', 'Offline',
    'Nothing breaks without a connection; it just says what\'s old and what\'s waiting.',
    'Any screen when the connection drops. Shown on plan home.',
    'Try again → reconnect. Comes back by itself when the connection returns.',
    'Paying, approving and settling are disabled with "Needs a connection". Recording, notes and photos queue and send later (marked "Waiting to send").',
    plan_home('offline'), h=1150)

add('N', '59', 'Something went wrong',
    'Errors in one sentence: what happened to the money, why, and what to do.',
    'Any money action that fails (pay, send, settle, approve).',
    'Try again → retries the same action safely (never double-charges). Get help → Help with the reference filled in.',
    'Copy is specific per case: money never moved (shown); rule changed while you were typing ("The rules changed. Check and try again."); someone else already settled.',
    ab('', icon='x')
    + f'<div class="sp"></div><div class="bigic n">{ic("alert", 32, 2)}</div>'
    + '<h2 class="d28 c mt16">That didn\'t go through</h2>'
    + '<p class="t17 c" style="margin:8px 12px 20px">Your money didn\'t move. The pot still has $446.00.</p>'
    + '<div class="card col8"><div class="ov">What happened</div><p class="t15" style="margin:0">Your phone lost connection while we were paying for the tram passes.</p>'
      '<div class="ov mt8">What to do</div><p class="t15" style="margin:0">Check your connection and try again. You won\'t be charged twice.</p></div>'
    + '<div class="mono t11 mut c mt12">Ref PL-4F2A · 14:05</div>'
    + '<div class="sp"></div>' + btn('Try again', 'pri', 'refresh') + btn('Get help', 'txt', cls='mt4'))

def sk(w, h, r=10, extra=''):
    return f'<div class="skel" style="width:{w};height:{h}px;border-radius:{r}px;{extra}"></div>'

add('N', '60', 'Loading: plan home',
    'Skeletons in the exact shape of 16 so nothing jumps when data arrives. The title is known, so it shows straight away.',
    'Opening a plan with no cached data (first open, or after restore).',
    'Data arrives → 16 with a quick fade. Over 8 s → 58-style "Taking a while" banner with Try again.',
    'Cached data skips this entirely. Shimmer is subtle and stops when reduced motion is on.',
    ab('🌊 Lisbon, 12–16 Oct', right=ib('users') + ib('more')) + '<div class="bleed">' + wb(LIS, '&nbsp;') + '</div>'
    + '<div class="card mt12">' + sk('30%', 10) + sk('55%', 34, 10, 'margin-top:10px') + sk('40%', 24, 999, 'margin-top:14px') + '</div>'
    + '<div class="row mt16" style="justify-content:space-between">' + ''.join(f'<div class="c">{sk("44px", 44, 999)}{sk("44px", 10, 6, "margin-top:8px")}</div>' for _ in range(5)) + '</div>'
    + '<div class="card mt16">' + sk('35%', 16) + ''.join(sk('100%', 8, 999, 'margin-top:20px') for _ in range(4)) + '</div>'
    + '<div style="margin-top:24px">' + sk('25%', 16) + '</div>'
    + ''.join(f'<div class="row mt16">{sk("36px", 36, 999)}<div class="lm">{sk("80%", 12)}{sk("50%", 10, 6, "margin-top:8px")}</div></div>' for _ in range(3))
    + '<div class="dock">' + btn('Add money', 'off', 'plus') + btn('Pay', 'off', 'out') + '</div>', h=1000)
