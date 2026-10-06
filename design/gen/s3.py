from base import *
from s2 import plan_home, plan_top, LIS

PAPER = ('<div class="paper"><b>TABERNA DO BAIRRO</b><div style="text-align:center">Rua da Rosa 12 · Lisboa</div><div style="border-top:1px dashed #999;margin:5px 0"></div>'
         '<div class="pl"><span>2 Sardinhas</span><span>19,00</span></div><div class="pl"><span>1 Polvo</span><span>9,50</span></div>'
         '<div class="pl"><span>Pão + azeite</span><span>2,50</span></div><div style="border-top:1px dashed #999;margin:5px 0"></div>'
         '<div class="pl" style="font-weight:700"><span>TOTAL</span><span>€31,00</span></div><div style="text-align:center;margin-top:4px">Obrigado!</div></div>')

# ------------------------------------------------------------------ H. Receipts & disputes
add('H', '29', 'Spend detail',
    'Everything about one spend: the receipt photo, the note, who shares it, and Proof.',
    'Feed item in 16; Activity (52); toast in 19.',
    'Question this spend → 30. Proof → public record in the browser. Back → 16.',
    'Photo loads blurred, then sharp once unlocked on the phone. No photo: "No receipt added". Window closed: the question button is replaced by "Questions closed 15 Oct".',
    ab('Dinner at Taberna', sub='Lisbon · paid by Sam', right=ib('share'))
    + f'<div class="rphoto">{PAPER}<span class="lockchip">{ic("lock", 14, 2.2)}Only the plan can see this</span></div>'
    + '<div class="row sbw mt16"><div class="hero"><span class="d34">$36.00</span><span class="t17 m2">£26.72</span></div><span class="chip sm">🍽️ Food &amp; drink</span></div>'
    + f'<div class="row t13 mut mt8" style="gap:8px">{av("sam", 24, flag=False)}Sam paid · Tue 13 Oct, 21:40</div>'
    + '<div class="card t mt12"><p class="t15" style="margin:0">“First night! Grilled sardines for three.”</p></div>'
    + '<div class="ov mt16">Split 3 ways · $12.00 each</div>'
    + li(av('sam', 32), 'Sam', 'New York', '$12.00', '')
    + li(av('maya', 32), 'Maya (you)', 'London', '$12.00', '£8.91')
    + li(av('asha', 32), 'Asha', 'Bengaluru', '$12.00', '₹1,003')
    + '<div class="card mt8 mono t13" style="line-height:1.8">'
      '<div class="row sbw"><span class="mut">Rule</span><span>Under $50 · went through</span></div>'
      '<div class="mut">Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC</div>'
      f'<div class="row sbw" style="font-family:Figtree"><span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}</div></div>'
    + '<div class="sp"></div>'
    + f'<div class="row sbw mt16"><span class="t13 mut row" style="gap:6px">{ic("clock", 16)}Questions open 46 h more</span>'
    + btn('Question this spend', 'dngo', 'flag', 'sm') + '</div>', h=1080)

SNACK = (f'<div class="card"><div class="row">{av("ben", 40)}<div class="lm"><div class="lt">Late-night snacks</div>'
         '<div class="t13 mut">Ben · Wed 14 Oct, 02:10 · split 4</div></div><div class="lr">$28.00<div class="t13 mut">£20.78</div></div></div></div>')

def radio_row(t, on=False):
    return f'<div class="li" style="min-height:52px"><span class="rad{" on" if on else ""}"></span><div class="lm"><div class="lt" style="font-weight:{600 if on else 500}">{t}</div></div></div>'

add('H', '30', 'Question a spend',
    'Anyone in the split can question a spend inside the review window. Plain reasons, an optional note.',
    '29 → Question this spend.',
    'Send to the group → 31 for everyone (push: "Maya questioned Late-night snacks").',
    'One open question per spend. The spender is told straight away and can reply in the thread.',
    ab('Question a spend', icon='x') + SNACK
    + '<h2 class="d22 mt20">What\'s wrong with it?</h2><div class="mt8">'
    + radio_row('Not part of the plan', True) + radio_row('Wrong amount') + radio_row('I wasn\'t there') + radio_row('Paid twice') + radio_row('Something else')
    + '</div><div class="mt12">' + field('Note for the group', 'We said snacks come out of our own pockets.<span class="caret"></span>', 'on') + '</div>'
    + '<div class="mt12">' + bn('inf', 'scale', 'What happens next', 'Everyone votes for 24 hours. If most say Ben should cover it, $28 moves to his share at settle-up. No one is charged now.') + '</div>'
    + '<div class="sp"></div><div class="dock mt12">' + btn('Send to the group', 'pri', 'send') + '</div>', h=960)

def vopt(title, sub, on=False):
    st = ' style="border:2px solid var(--ink)"' if on else ''
    return (f'<div class="card"{st}><div class="row"><span class="rad{" on" if on else ""}"></span><div class="lm"><div class="lt">{title}</div>'
            f'<div class="t13 mut">{sub}</div></div></div></div>')

def bubble(k, text, me=False):
    side = 'flex-direction:row-reverse;' if me else ''
    bg = 'var(--surface-2)' if not me else 'color-mix(in srgb,var(--accent) 22%,var(--surface))'
    return (f'<div class="row" style="{side}align-items:flex-end;gap:8px">{av(k, 28, flag=False)}'
            f'<div style="background:{bg};padding:10px 12px;border-radius:16px;max-width:250px" class="t15">{text}</div></div>')

add('H', '31', 'Dispute vote',
    'A short, fair vote. Both sides speak, then everyone picks one of two outcomes.',
    'Push or Activity; 30 for the person who asked.',
    'Confirm vote → this screen with "You voted" and the live tally. When time runs out or a majority is reached → 32.',
    'Ties keep the spend on the plan. Voting stays open even after a majority so everyone is heard, but the result is fixed.',
    ab('Vote', sub='Lisbon, 12–16 Oct', icon='x')
    + f'<span class="chip sm inf mono" style="align-self:flex-start">{ic("clock", 14, 2.2)}18 h 20 m left</span>'
    + '<h2 class="d28 mt12">Should Ben cover the late-night snacks?</h2>'
    + '<div class="mt12">' + SNACK + '</div>'
    + '<div class="col mt16">' + bubble('maya', 'We said snacks come out of our own pockets.', True)
    + bubble('ben', 'It was for everyone, honest! 🥙') + '</div>'
    + '<div class="col mt20">' + vopt('Keep it on the plan', 'Everyone shares $28 as now') + vopt('Ben covers it', '$28 moves to Ben\'s share at settle-up', True) + '</div>'
    + '<div class="row sbw mt16 t13"><span class="vote"><span class="vbar"><i class="y"></i><i class="y"></i><i class="n"></i><i></i></span></span>'
      '<span class="mut">2 cover · 1 keep · Asha hasn\'t voted</span></div>'
    + '<div class="sp"></div><div class="dock mt16">' + btn('Confirm vote', 'pri', 'check') + '</div>', h=960)

add('H', '32', 'Dispute resolved',
    'The outcome in one sentence, the votes, and what changes for whom.',
    '31 when the vote closes.',
    'Done → 16. Proof → public record of the vote.',
    'Other outcome: "The group kept it on the plan. Nothing changes." Everyone gets the same screen as a push.',
    ab('', icon='x')
    + f'<div class="c"><div class="bigic i">{ic("scale", 34, 2)}</div><h2 class="d28 mt16">Ben covers the late-night snacks</h2>'
    '<p class="t15 mut" style="margin:8px 12px 20px">3 of 4 voted for it. Nothing is charged now. It evens out at settle-up.</p></div>'
    + '<div class="card col8">'
    + f'<div class="row sbw"><span class="lt">Ben covers it</span><span class="row" style="gap:8px">{avs(["maya", "sam", "asha"], 24)}<b>3</b></span></div>'
    + '<div class="bar"><i style="width:75%;background:var(--pos)"></i></div>'
    + f'<div class="row sbw mt8"><span class="lt">Keep it on the plan</span><span class="row" style="gap:8px">{avs(["ben"], 24)}<b>1</b></span></div>'
    + '<div class="bar"><i style="width:25%;background:var(--muted)"></i></div></div>'
    + '<div class="card mt12">'
    + li(av('ben', 36), 'Ben\'s share', 'Pays the full $28.00', '<span class="neg">+$21.00</span>', '£15.59')
    + li(av('maya', 36), 'Your share', 'Was $7.00', '<span class="pos">−$7.00</span>', '£5.20')
    + f'<div class="row sbw mt8"><span class="t13 mut">Closed Thu 15 Oct · 02:10</span>{proof()}</div></div>'
    + '<div class="sp"></div>' + btn('Done'))

# ------------------------------------------------------------------ I. Safety
add('I', '33', 'Pause spending',
    'An emergency brake anyone can pull. It explains what pausing does and how it ends.',
    '17 → Pause spending; 16 ⋯ → Pause.',
    'Pause now → fingerprint → 34 for everyone. Cancel → back.',
    'Reason is optional but shown to everyone. If the plan is already paused, this button reads "Already paused".',
    plan_home(),
    over=app_sheet(f'<div class="bigic n" style="width:56px;height:56px;margin:0">{ic("pause", 26, 2)}</div>'
                   '<h3 class="d22 mt12">Pause spending?</h3>'
                   '<p class="t15 mut" style="margin:6px 0 12px">No one can pay from the pot until the group votes to resume. The money stays put.</p>'
                   '<div class="col8 t13">'
                   f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("phone", 18)}</span>Use it if a phone is lost or a spend looks wrong.</div>'
                   f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("bell", 18)}</span>Everyone is told straight away.</div>'
                   f'<div class="row" style="gap:8px;align-items:flex-start"><span class="mut">{ic("vote", 18)}</span>Resuming needs 3 of 4 to agree.</div></div>'
                   '<div class="mt16">' + field('Reason (optional)', 'A spend I don\'t recognise') + '</div>'
                   '<div class="btns mt16">' + btn('Cancel', 'sec') + btn('Pause now', 'dng', 'pause') + '</div>'), h=900)

add('I', '34', 'Paused plan',
    'What everyone sees while the pot is frozen: who paused, why, and the vote to resume.',
    '33 by anyone; push "Ben paused spending in Lisbon".',
    'Vote to resume → fingerprint → tally updates. At 3 of 4 the banner turns green "Spending is back on" for 5 s, then disappears.',
    'Pay is disabled everywhere (22c). Adding money, recording and questions still work. Ending the plan is allowed while paused.',
    plan_home('paused'), h=1170)

def diff(label, old, new):
    return (f'<div class="li"><div class="lm"><div class="lt">{label}</div></div>'
            f'<span class="mut" style="text-decoration:line-through">{old}</span><span class="mut">{ic("chev", 16)}</span><span class="d17 pos">{new}</span></div>')

def voter(k, name, state):
    s = {'y': f'<span class="pos row b" style="gap:4px">{ic("check", 16, 2.4)}Agreed</span>', 'w': '<span class="mut">Not yet</span>'}[state]
    left = '<span class="row" style="gap:10px">' + av(k, 28, flag=False) + name + '</span>'
    return f'<div class="row sbw" style="min-height:40px">{left}{s}</div>'

add('I', '35', 'Change the rules',
    'Rules change only by vote. The proposal shows a clear before → after and nothing else.',
    '17 → Propose a change (built in 12); 22b → Ask to raise budget; push.',
    'Agree / Disagree → fingerprint → tally. At 3 of 4 the new rules apply at once and the feed says so.',
    'Proposer\'s vote counts automatically. Closes after 24 h; if not enough agree, nothing changes. Only one proposal at a time.',
    ab('Rule change', sub='Lisbon, 12–16 Oct', icon='x')
    + f'<div class="row">{av("ben", 40)}<div><div class="lt">Ben suggests a change</div><div class="t13 mut">2 h ago · closes in 22 h</div></div></div>'
    + '<h2 class="d28 mt16">Raise the food budget</h2>'
    + '<div class="card t mt12"><p class="t15" style="margin:0">“Food\'s pricier than we thought. Let\'s not block dinners.”</p></div>'
    + '<div class="card mt12" style="padding-top:4px;padding-bottom:4px">' + diff('🍽️ Food &amp; drink budget', '$120', '$180') + diff('Daily cap', '$300', '$400') + '</div>'
    + '<p class="t13 mut" style="margin:8px 2px 0">Nothing else changes.</p>'
    + '<div class="row sbw mt20"><span class="ov">Votes · needs 3 of 4</span><span class="vbar"><i class="y"></i><i class="y"></i><i></i><i></i></span></div>'
    + '<div class="mt8">' + voter('ben', 'Ben', 'y') + voter('sam', 'Sam', 'y') + voter('asha', 'Asha', 'w') + voter('maya', 'You', 'w') + '</div>'
    + '<div class="sp"></div><div class="dock mt16">' + btn('Disagree', 'sec') + btn('Agree', 'pri', 'fp') + '</div>')

add('I', '36', 'Leave the plan',
    'Leaving early is allowed and fair: you get your share back now, in your own money.',
    '17 → ⋯ → Leave plan.',
    'Leave → fingerprint → home (07) with a receipt in Activity. Cancel → back.',
    'Blocked while a vote or question about your spends is open ("Wait for the vote on Late-night snacks"). If you owe, it shows "You pay $X to leave" instead.',
    ab('Leave Lisbon?', icon='x')
    + '<p class="t15 mut" style="margin:0 0 16px">You get your share back now. Spends you were part of stay split as they are.</p>'
    + stub('<div class="row sbw"><span class="ov">Your share · Lisbon</span><span>🌊</span></div>'
           '<div class="hero mt8"><span class="d34">£92.23</span><span class="t17 m2">$124.25</span></div><div class="t15 b mt4">Back to your Plans account</div>',
           [('Put in', '$200.00'), ('Paid yourself', '+$42.00'), ('Your share of spends', '−$117.75'), ('Back to you', '<b>$124.25</b>'),
            ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC')])
    + '<div class="mt16">' + bn('acc', 'alert', 'Leaving is final', 'To come back, someone will need to invite you again.') + '</div>'
    + '<div class="sp"></div>' + btn('Leave and get £92.23', 'dng', 'logout') + btn('Stay in the plan', 'txt', cls='mt4'))

# ------------------------------------------------------------------ J. Ending
def ack(k, name, ok):
    s = f'<span class="pos row b" style="gap:4px">{ic("check", 16, 2.4)}Looks right</span>' if ok else '<span class="mut">Not yet</span>'
    return li(av(k, 36), name, P[k]['city'], s, '')

add('J', '37', 'Plan ended: review',
    'Before anyone is paid, everyone checks the numbers. One tap: "Looks right".',
    'End date passes, or someone taps End plan (16 ⋯). Push to everyone.',
    'Looks right → your row ticks. When all have agreed (or 24 h pass) → 38. Something\'s wrong → 30 on a chosen spend.',
    'Spending is closed from here. Open questions must finish first; the banner lists them.',
    plan_top(band='Ended 17 Oct · checking', right=ib('more'))
    + '<h2 class="d28 mt16">Lisbon has ended. Does it look right?</h2>'
    + '<p class="t15 mut" style="margin:8px 0 16px">Check the spends before anyone is paid. Settle-up opens when everyone agrees, or in 24 hours.</p>'
    + '<div class="card"><div class="row" style="justify-content:space-between;text-align:left">'
      '<div><div class="ov">Spent</div><div class="d22 mt4">$687.60</div></div>'
      '<div><div class="ov">Left</div><div class="d22 mt4">$112.40</div></div>'
      '<div><div class="ov">Spends</div><div class="d22 mt4">18</div></div></div>'
      '<div class="hr"></div><div class="row sbw"><span class="chip sm pos">You\'re owed £18.00</span>'
      f'<span class="t13 b row" style="gap:2px">See all spends{ic("chev", 16, 2.2)}</span></div></div>'
    + '<div class="ov mt20">Who\'s checked · 2 of 4</div>'
    + ack('sam', 'Sam', True) + ack('asha', 'Asha', True) + ack('ben', 'Ben', False) + ack('maya', 'Maya (you)', False)
    + '<div class="sp"></div><div class="dock mt16">' + btn('Something\'s wrong', 'sec') + btn('Looks right', 'pri', 'check') + '</div>')

def payout(k, name, a, b):
    return li(av(k, 40), name, P[k]['city'], f'<span class="d17">{a}</span>', b)

def edge(a, b, label):
    return (f'<div class="row" style="gap:0;min-height:56px">{av(a, 36)}<span class="t13 b" style="width:44px;margin-left:8px">{P[a]["n"]}</span>'
            f'<span class="arrowline"><em>{label}</em></span>{av(b, 36)}<span class="t13 b" style="margin-left:8px">{P[b]["n"]}</span></div>')

add('J', '38', 'Settle-up preview',
    'Who gets what, each in their own money, and the two arrows that explain why.',
    '37 when everyone has agreed.',
    'Settle up → fingerprint → 39 → 40. Anyone in the plan can press it; it only runs once.',
    'If someone owes more than the pot covers, their safety net is used (up to $100) and the arrow is labelled "from safety net". Anything beyond that becomes 42.',
    ab('Settle up', sub='Lisbon, 12–16 Oct')
    + '<h2 class="d28">Here\'s who gets what</h2>'
    + '<p class="t15 mut" style="margin:8px 0 12px">Everyone is paid at once, in their own money.</p>'
    + '<div class="card" style="padding-top:4px;padding-bottom:4px">'
    + payout('maya', 'Maya (you)', '£38.86', '$52.35') + payout('sam', 'Sam', '$28.10', 'dollars')
    + payout('asha', 'Asha', '₹1,674', '$20.02') + payout('ben', 'Ben', '£8.86', '$11.93') + '</div>'
    + '<div class="ov mt20">How we got there</div>'
    + '<div class="card mt8" style="padding-top:22px">' + edge('ben', 'maya', '£12.00') + '<div style="height:14px"></div>' + edge('asha', 'maya', '₹676 · £6.00')
    + '<p class="t13 mut" style="margin:12px 0 0">Then the $112.40 left in the pot is shared 4 ways, $28.10 each.</p></div>'
    + '<div class="mono t11 mut mt12">Rates ECB 14:05 UTC · GBP 1.3472 · INR 83.60</div>'
    + '<div class="sp"></div><div class="dock mt16">' + btn('Settle up · one tap', 'pri', 'fp') + '</div>', h=960)

SPIN = ('<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" stroke-width="10"/>'
        '<circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" stroke-dasharray="210 400" transform="rotate(-90 60 60)"/></svg>')

def prog(k, name, amt, state):
    s = {'ok': f'<span class="pos row b" style="gap:4px">{ic("check", 16, 2.6)}Paid</span>',
         'go': '<span class="row b" style="gap:6px"><span class="dot" style="background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 30%,transparent)"></span>Paying</span>',
         'q': '<span class="mut">Next</span>'}[state]
    return li(av(k, 36), name, amt, s, '')

add('J', '39', 'Settling',
    'The one-tap moment. It is fast, so this screen is mostly a heartbeat, but it never pretends.',
    '38 → Settle up → fingerprint.',
    'All paid → 40 (automatic). Failure → 59 with "Nobody was paid; try again".',
    'Usually under a second. If it takes over 5 s: "Taking longer than usual. You can leave; we\'ll tell you when it\'s done."',
    '<div class="c mt32"><div style="position:relative;width:120px;height:120px;margin:0 auto">' + SPIN
    + '<span class="mono b" style="position:absolute;inset:0;display:grid;place-items:center;font-size:20px">0.4 s</span></div>'
    + '<h2 class="d28 mt20">Settling up…</h2><p class="t15 mut" style="margin:8px 16px 24px">Paying everyone at once. This takes under a second.</p></div>'
    + '<div class="card" style="padding-top:4px;padding-bottom:4px">'
    + prog('maya', 'Maya', '£38.86', 'ok') + prog('sam', 'Sam', '$28.10', 'ok') + prog('asha', 'Asha', '₹1,674', 'go') + prog('ben', 'Ben', '£8.86', 'q') + '</div>'
    + '<div class="sp"></div><p class="t13 mut c" style="margin:0 0 8px">You can leave this screen. We\'ll tell you when it\'s done.</p>')

add('J', '40', 'Settled',
    'Done. Each person\'s payout in their own money, the measured time, and who paid the network cost.',
    '39 when everything lands.',
    'Done → 41. Share → image of the stub. Proof → public record.',
    'Everyone gets a push: "Lisbon is settled. You got £38.86." The plan becomes read-only.',
    f'<div style="position:absolute;inset:0;pointer-events:none;opacity:.8">' + ''.join(
        f'<span class="conf" style="left:{x}px;top:{y}px;background:{c};transform:rotate({r}deg)"></span>'
        for x, y, c, r in [(30, 30, W['lagoon'], 20), (90, 90, W['marigold'], -30), (300, 40, W['orchid'], 45), (340, 110, W['lime'], -15), (200, 20, W['coral'], 30)]) + '</div>'
    + f'<div class="c mt24"><div class="bigic p">{ic("check", 36, 2.4)}</div><h2 class="d34 mt12">All settled</h2>'
    f'<span class="chip sm pos mt8">{ic("zap", 14, 2.2)}Settled in 0.6 s</span></div>'
    + '<div class="mt20">' + stub('<div class="row sbw"><span class="ov">Lisbon, 12–16 Oct · settle-up</span><span>🌊</span></div>'
           '<div class="d28 mt8">$112.40 paid out</div>',
           [('Maya · London', '<b>£38.86</b>'), ('Sam · New York', '<b>$28.10</b>'), ('Asha · Bengaluru', '<b>₹1,674</b>'), ('Ben · Manchester', '<b>£8.86</b>'),
            ('', 'Rates ECB 14:05 UTC · GBP 1.3472 · INR 83.60'), ('Network cost', '$0.0008, covered by Plans')],
           f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}') + '</div>'
    + '<div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Done') + '</div>')

def stat(v, l):
    return f'<div class="card" style="padding:14px"><div class="d22">{v}</div><div class="t13 mut">{l}</div></div>'

add('J', '41', 'Settled plan memory',
    'A keepsake, not a ledger. The plan stays as a read-only summary you can download.',
    '40 → Done; any settled plan from home.',
    'Download summary → PDF and CSV to the phone. All spends → read-only list (29 without the question button).',
    'Read-only everywhere. Photos stay private to members. "Start a new plan with these people" pre-fills 10.',
    ab('', right=ib('share'))
    + f'<div class="band" style="--w:{LIS};position:relative;width:auto;margin:0 -40px;transform:rotate(-3deg);justify-content:center"><span>LISBON · 12–16 OCT · SETTLED</span><i></i></div>'
    + '<div class="c mt24"><h2 class="d34">Lisbon, 12–16 Oct</h2><p class="t15 mut" style="margin:6px 0 0">Settled 17 Oct · read-only</p></div>'
    + f'<div class="row mt12" style="justify-content:center">{avs(["maya", "sam", "asha", "ben"], 32)}<span class="t13 mut">4 friends · 3 countries</span></div>'
    + '<div class="mt20" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + stat('$687.60', 'spent together') + stat('18', 'spends') + stat('⛵ $250', 'biggest: boat trip') + stat('0.6 s', 'to settle up') + '</div>'
    + f'<div class="card mt12" style="--plan:{LIS}"><div class="ov">Where it went</div>'
    + ''.join(f'<div class="mt12"><div class="row sbw t13"><span class="b">{n}</span><span class="mut">{v}</span></div><div class="bar mt4"><i style="width:{p}%;background:var(--plan)"></i></div></div>'
              for n, v, p in [('⛵ Activities', '$250.00', 100), ('🛏️ Stay', '$240.00', 96), ('🍽️ Food &amp; drink', '$147.60', 59), ('🚋 Transport', '$50.00', 20)])
    + '</div>'
    + '<div class="sp"></div>' + btn('Download summary', 'sec', 'download', 'mt16') + btn('Start a new plan with these people', 'txt', cls='mt4'), h=1000)

add('J', '42', 'Debt carried',
    'When the safety net wasn\'t enough. Clear, calm, and one tap to fix.',
    'Home card "You owe £8.91 · Pay now"; push reminders (weekly, can be muted).',
    'Pay now → fingerprint → receipt (like 47) and the debt clears for both. Not enough money → Add money first.',
    'Ben sees the mirror: "Maya owes you £8.91" with a gentle Remind button (once a week max).',
    plan_top('Glastonbury crew', '🎪', W['orchid'], 'Ended 28 Jun · settled', right=ib('more'))
    + f'<div class="c mt24"><div class="bigic n">{ic("receipt", 32, 2)}</div><h2 class="d34 mt16">You owe Ben $12.00</h2>'
      '<div class="t17 m2 mt4">£8.91</div></div>'
    + '<div class="card mt20 col8 t15">'
    + '<div class="row sbw"><span class="mut">You owed at settle-up</span><span>$112.00</span></div>'
    + '<div class="row sbw"><span class="mut">Safety net covered</span><span class="pos">−$100.00</span></div>'
    + '<div class="hr" style="margin:4px 0"></div>'
    + '<div class="row sbw b"><span>Still to pay</span><span>$12.00 · £8.91</span></div></div>'
    + f'<div class="li mt8">{av("ben", 40)}<div class="lm"><div class="lt">Ben · Manchester</div><div class="t13 mut">Waiting since 28 Jun</div></div></div>'
    + bn('mut', 'info', 'Ben gets £8.91 straight away', 'No fees. It clears for both of you.')
    + '<div class="sp"></div><div class="dock mt16">' + btn('Pay now · $12.00', 'pri', 'fp') + '</div>')
