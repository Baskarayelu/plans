from base import *

LIS = W['lagoon']

def plan_top(title='Lisbon, 12–16 Oct', e='🌊', color=LIS, band='Day 2 of 5 · 4 people · 3 countries', right=None, d=''):
    r = right if right is not None else ib('users') + ib('more')
    return ab(f'{e} {title}{d}', right=r) + '<div class="bleed">' + wb(color, band) + '</div>'

def pot_card(state=''):
    return ('<div class="card mt12"><div class="row sbw"><span class="ov">In the pot</span><span class="t13 mut">4 put in $800.00</span></div>'
            '<div class="hero mt4"><span class="d34">$446.00</span><span class="t17 m2">£331.06</span></div>'
            f'<div class="row sbw mt12"><span class="chip sm pos">You\'re owed £18.00</span><span class="t13 b row" style="gap:2px">Why{ic("chev", 16, 2.2)}</span></div></div>')

def member_strip():
    data = [('maya', 'You', '+£18.00', 'pos'), ('sam', 'Sam', 'All square', 'mut'), ('asha', 'Asha', '−₹676', 'neg'), ('ben', 'Ben', '−£12.00', 'neg')]
    cells = ''.join(f'<div class="c" style="width:68px">{av(k, 44, ring=(k == "maya"))}<div class="t13 b mt8">{n}</div><div class="t11 b {c}">{v}</div></div>' for k, n, v, c in data)
    plus = f'<div class="c" style="width:56px"><span class="ib f" style="margin:0 auto;width:44px;height:44px">{ic("plus", 20)}</span><div class="t13 mut mt8">Invite</div></div>'
    return f'<div class="row mt16" style="justify-content:space-between;gap:0">{cells}{plus}</div>'

def bud(e, name, spent, total, pct, extra='', over=False, pend=0):
    p = f'<i class="pend" style="width:{pend}%"></i>' if pend else ''
    x = f'<div class="t11 inf b mt4">{extra}</div>' if extra else ''
    return (f'<div class="mt12"><div class="row sbw t13"><span class="b">{e} {name}</span><span class="mut tnum">{spent} of {total}</span></div>'
            f'<div class="bar mt4"><i style="width:{pct}%;background:var(--plan,var(--ink))"></i>{p}</div>{x}</div>')

def budgets():
    return (f'<div class="card mt16" style="--plan:{LIS}"><div class="row sbw"><span class="d17">Budgets</span>'
            f'<span class="t13 mut row" style="gap:2px">Rules{ic("chev", 16)}</span></div>'
            + bud('🛏️', 'Stay', '$240', '$300', 80) + bud('🍽️', 'Food &amp; drink', '$96', '$120', 80)
            + bud('🚋', 'Transport', '$18', '$80', 22) + bud('⛵', 'Activities', '$0', '$300', 0, '$250 waiting for an OK', pend=83)
            + '</div>')

def feed(new=False):
    n = ' new' if new else ''
    tag = ' <span class="chip sm acc" style="height:20px;font-size:11px">New</span>' if new else ''
    return ('<div class="sec-h"><span class="d17 row" style="gap:10px"><span class="dot"></span>Live</span><a>All spends</a></div><div class="feed">'
            + li(av('sam', 36), f'Sam paid $36.00 · Dinner at Taberna{tag}', 'Food &amp; drink · split 3 · your share £8.91', '', '2 min', n)
            + li(av('asha', 36), 'Asha wants $250.00 · Boat trip', '<span class="inf b">Needs 1 more OK</span>', btn('Review', 'sec', cls='sm', style='height:40px'), '')
            + li(av('maya', 36), 'You paid $18.00 · Tram passes', 'Transport · split 3', '', '1 h')
            + li(av('ben', 36), 'Ben paid $240.00 · Villa deposit', 'Stay · split 4', '', 'Mon')
            + '</div>')

def dock(pay=True, label='Pay'):
    p = btn(label, 'pri', 'out') if pay else btn(label, 'off', 'ban')
    return f'<div class="dock">{btn("Add money", "sec", "plus")}{p}</div>'

def plan_home(state='normal'):
    top = plan_top()
    banner = ''
    dim = ''
    d = dock()
    if state == 'paused':
        banner = ('<div class="mt12">' + bn('neg', 'pause', 'Spending is paused',
                  'Ben paused it at 14:20: “Lost my phone on the tram.”',
                  '<div class="vote mt8"><div class="vbar"><i class="y"></i><i></i><i></i></div><span class="t13">1 of 3 votes to resume</span></div>'
                  '<div class="btns mt12">' + btn('Keep paused', 'sec', cls='sm') + btn('Vote to resume', 'pri', cls='sm') + '</div>') + '</div>')
        d = dock(False, 'Paused')
    if state == 'offline':
        banner = ('<div class="mt12">' + bn('mut', 'wifioff', 'You\'re offline', 'Showing what we had at 14:02. New spends will appear when you\'re back.',
                  '<div class="mt8">' + btn('Try again', 'sec', 'refresh', 'sm', style='height:40px') + '</div>') + '</div>')
        dim = ' style="opacity:.55"'
        d = dock(False, 'Needs a connection')
    body = top + banner + f'<div{dim}>' + pot_card() + member_strip() + budgets() + feed(state == 'toast') + '</div>' + d
    return body

# ------------------------------------------------------------------ E. Plan
add('E', '16', 'Plan home',
    'The heart of the app. Pot, your position, everyone\'s position in their own money, budgets, and a live feed.',
    'Home plan card; push notifications; links.',
    'Pay → 20. Add money → 18. Member or Why → 17. Feed item → 29. Review → 27. ⋯ → Pause (33), Record (25), End plan (37), Leave (36).',
    'Live dot pulses while connected. Budget bars turn red past 100%. Pending spends show as striped bars. Paused (34), offline (58), loading (60).',
    plan_home(), h=1070)

add('E', '17', 'Members & rules',
    'Who is in, what each person put in, and the rules in plain words. The safety buttons live here too.',
    '16 → member strip, people icon or Rules.',
    'Invite → 13. Propose a change → 12 in proposal mode → 35. Pause spending → 33. Leave plan → 36.',
    'Positions update live. Anyone can propose or pause; no one has extra powers, including whoever started the plan.',
    ab('Members &amp; rules', sub='Lisbon, 12–16 Oct', right=ib('plus'))
    + '<div class="ov">4 people · 3 countries</div>'
    + li(av('maya', 40), 'Maya (you)', 'London · put in $200.00', '<span class="pos">+£18.00</span>', 'owed to you')
    + li(av('sam', 40), 'Sam', 'New York · put in $200.00', '$0.00', 'all square')
    + li(av('asha', 40), 'Asha', 'Bengaluru · put in $200.00', '<span class="neg">−₹676</span>', 'owes · £6.00')
    + li(av('ben', 40), 'Ben', 'Manchester · put in $200.00', '<span class="neg">−£12.00</span>', 'owes')
    + '<div class="row sbw mt20"><span class="ov">Rules · Balanced</span><span class="t13 mut">Agreed 12 Oct</span></div>'
    + '<div class="card mt8 col">'
    + ''.join(f'<div class="row" style="align-items:flex-start;gap:12px"><span class="mut">{ic(i, 20)}</span><span class="t15">{t}</span></div>' for i, t in [
        ('zap', 'Up to $50 goes through now.'),
        ('users', '$50–$200 needs 1 OK. Over $200 needs 2.'),
        ('cal', 'The pot can spend up to $300 a day.'),
        ('receipt', 'Budgets: Stay $300, Food &amp; drink $120, Transport $80, Activities $300.'),
        ('link', 'Can pay members, businesses, and anyone by link.'),
        ('scale', 'Any spend can be questioned for 48 hours.'),
        ('shield', 'Safety net: up to $100 each if someone owes at the end.')])
    + '</div>'
    + '<div class="sp" style="min-height:16px"></div><div class="btns">' + btn('Pause spending', 'dngo', 'pause') + btn('Propose a change', 'sec', 'edit') + '</div>', h=900)

add('E', '18', 'Add money to the pot',
    'Type in your own currency; see exactly what the pot gets in dollars.',
    '16 → Add money; 15 (join) for later top-ups.',
    'Add → fingerprint → back to 16 with a feed item "You added $26.94".',
    'Not enough in your account: that row is disabled with "Add money first". Card/bank route uses Google Pay; test version shows 55 instead.',
    ab('Add to Lisbon pot', icon='x')
    + '<div class="c mt16"><div class="d56">£20<span class="caret" style="display:inline-block;width:3px;height:48px;background:var(--accent);vertical-align:-6px;margin-left:2px"></span></div>'
      '<div class="t17 mt8">The pot gets <b>$26.94</b></div>'
      '<div class="mono t11 mut mt8">Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC</div></div>'
    + '<div class="card mt20" style="padding:4px 16px"><div class="ov" style="padding-top:12px">Pay with</div>'
    + li(tile('ticket'), 'Your Plans account', '$5.00 · £3.71 · not enough', '<span class="rad"></span>', '', 'dim')
    + li(tile('card'), 'Card or bank', 'Google Pay · lands in about a minute', '<span class="rad on"></span>')
    + '</div>'
    + '<div class="sp"></div>' + kp() + btn('Add £20.00', cls='mt8'), h=900)

TOAST = (f'<div class="toast">{av("sam", 40)}<div class="tt"><div class="lt">Sam paid $36 · Dinner at Taberna</div>'
         '<div class="t13 mut">Lisbon · your share $12.00 · £8.91</div></div><span class="mono t11 mut">now</span></div>')

add('E', '19', 'Live spend arriving',
    'A friend\'s spend lands while you are looking at the plan. Banner on top, item highlighted in the feed.',
    'Real-time update while 16 is open. If the app is closed, the same text arrives as a push notification.',
    'Tap banner → 29. It slides away after 4 s.',
    'Haptic: one light tick (Android CONFIRM) as the banner drops. No sound. Budgets and positions animate to their new values. Several at once group into "3 new spends".',
    plan_home('toast'), over=TOAST, h=1070)

# ------------------------------------------------------------------ F. Spend
add('F', '20', 'Pay: who',
    'Three kinds of payee, in the order people use them: a friend in the plan, a business, someone outside.',
    '16 → Pay.',
    'Friend or business → 21. Scan → camera (as 44). Pay link → 21 with "by link", then 26.',
    'Payee types switched off in the rules are hidden, not greyed out. Search covers people and businesses paid before.',
    ab('Pay from the pot', sub='Lisbon · $446.00 left', icon='x')
    + field('', f'<span class="mut row" style="gap:8px">{ic("search", 20)}Search people or businesses</span>')
    + '<div class="ov mt20">Someone in the plan</div><div class="row mt12" style="gap:20px">'
    + ''.join(f'<div class="c">{av(k, 48)}<div class="t13 b mt8">{P[k]["n"]}</div></div>' for k in ['sam', 'asha', 'ben'])
    + '</div>'
    + '<div class="ov mt24">A business</div>'
    + li(tile('scan', 'a'), 'Scan a business\'s Plans code', 'Cafés, tours and hostels that take Plans', ic('chev', 20))
    + li(emo('🍽️', W['coral'], 40), 'Taberna do Bairro', 'Paid before · Food &amp; drink', ic('chev', 20))
    + li(emo('⛵', LIS, 40), 'Sunset Boats Lisboa', 'Paid before · Activities', ic('chev', 20))
    + li(emo('🚋', W['marigold'], 40), 'Rossio Tram Kiosk', 'Nearby · Transport', ic('chev', 20))
    + '<div class="ov mt24">Someone outside the plan</div>'
    + li(tile('link'), 'Send a pay link', 'They claim it in their own money. No app needed to start.', ic('chev', 20))
    + '<div class="sp"></div>' + bn('inf', 'info', 'Under $50 goes through now', 'Bigger spends wait for a friend\'s OK.'), h=930)

CATS = [('🛏️', 'Stay'), ('🍽️', 'Food &amp; drink'), ('🚋', 'Transport'), ('⛵', 'Activities'), ('✨', 'Other')]

def spend_form(payee, sub, amt, loc, cat, split_on, split_note, banner, dock_html, photo=True, note='3-day tram passes', h=980):
    cats = ''.join(chip(f'{e} {n}', 'on' if n == cat else '') for e, n in CATS)
    splits = ''.join(chip(t, 'on' if t == split_on else '') for t in ['Everyone (4)', '3 people', 'Custom'])
    ph = (f'<span class="thumb"><i></i></span><div class="lm"><div class="lt">Receipt photo</div><div class="t13 mut">Only the plan can see it</div></div>'
          if photo else f'<span class="addph">{ic("camera", 22)}</span><div class="lm"><div class="lt">Add receipt photo</div><div class="t13 mut">Optional</div></div>')
    return (ab(payee, sub=sub)
            + f'<div class="c mt4"><div class="d56">{amt}</div><div class="t17 m2 mt4">{loc}</div>'
              f'<span class="chip sm ol mt8">{ic("swap", 14, 2)}Type in pounds</span></div>'
            + f'<div class="ov mt20">Category</div><div class="wrapc mt8">{cats}</div>'
            + f'<div class="ov mt20">Split</div><div class="wrapc mt8">{splits}</div>'
            + f'<div class="row mt8 t13">{split_note}</div>'
            + f'<div class="row mt16">{ph}</div>'
            + '<div class="mt12">' + field('Note', note) + '</div>'
            + '<div class="sp" style="min-height:12px"></div>' + banner + dock_html)

FP_DOCK = '<div class="dock mt12">' + btn('Confirm with fingerprint', 'pri', 'fp') + '</div>'
SPLIT3 = f'{avs(["maya", "sam", "asha"], 24)}<span class="mut">Maya, Sam, Asha · <b style="color:var(--ink)">$6.00 each</b> · £4.45</span>'

add('F', '21', 'Spend form',
    'One screen to pay from the pot. The rule preview at the bottom says what will happen before you confirm.',
    '20 after choosing a payee (here, a tram kiosk).',
    'Confirm with fingerprint → system sheet → 24. Split "Custom" or tapping the names → 23.',
    'Preview updates as you type: goes through now (shown), needs OKs (22a), blocked by budget (22b), paused (22c). Amount can be typed in dollars or pounds.',
    spend_form('Pay Rossio Tram Kiosk', 'From Lisbon pot', '$18.00', '£13.36', 'Transport', '3 people', SPLIT3,
               bn('pos', 'zap', 'Goes through now', 'Under $50, and Transport has $62 left after this.'), FP_DOCK))

add('F', '22a', 'Rule preview: needs 1 more approval',
    'A mid-size spend. The button changes to asking, and the copy says who will be asked.',
    '21 when the amount crosses $50.',
    'Ask for an OK → request sent → 16 with a waiting item. Friends get 27.',
    'Over $200 says "Needs 2 OKs". Requests expire after 24 h and the money never leaves the pot until approved.',
    spend_form('Pay Lisboa Surf School', 'From Lisbon pot', '$120.00', '£89.07', 'Activities', 'Everyone (4)',
               f'{avs(["maya", "sam", "asha", "ben"], 24)}<span class="mut">Everyone · <b style="color:var(--ink)">$30.00 each</b> · £22.27</span>',
               bn('inf', 'users', 'Needs 1 more approval', '$50–$200 needs one friend\'s OK. We\'ll ask Sam, Asha and Ben. It\'s paid the moment one says yes.'),
               '<div class="dock mt12">' + btn('Ask for an OK', 'pri', 'send') + '</div>', note='Lesson for 4, Sat morning'))

add('F', '22b', 'Rule preview: over budget (blocked)',
    'The pot can\'t pay this. Instead of a dead end, two ways forward.',
    '21 when the spend would push a category past its budget.',
    'Split it → form becomes $24 from pot plus a $12 record (25). Ask to raise → 35 prefilled.',
    'Daily cap hit uses the same pattern: "Over today\'s $300 limit by $X. Resets at midnight Lisbon time."',
    spend_form('Pay Cervejaria Ramiro', 'From Lisbon pot', '$36.00', '£26.72', 'Food &amp; drink', '3 people',
               SPLIT3.replace('$6.00 each', '$12.00 each').replace('£4.45', '£8.91'),
               bn('neg', 'ban', 'Over the Food &amp; drink budget by $12', 'Only $24 left of $120.',
                  f'<div class="col8 mt8"><span class="row b t13" style="gap:6px">{ic("chev", 16, 2.4)}Pay $24 from the pot, record $12 as paid by me</span>'
                  f'<span class="row b t13" style="gap:6px">{ic("chev", 16, 2.4)}Ask the group to raise the budget</span></div>'),
               '<div class="dock mt12">' + btn('Can\'t pay this from the pot', 'off', 'ban') + '</div>', note='Second dinner', h=1010))

add('F', '22c', 'Rule preview: plan is paused',
    'Spending is frozen, so the form says so before any typing is wasted.',
    '21 (or 20) while the plan is paused.',
    'Vote to resume → 34. Record as paid by me → 25 with these details.',
    'Same banner appears at the top of 20 while paused.',
    spend_form('Pay Rossio Tram Kiosk', 'From Lisbon pot', '$18.00', '£13.36', 'Transport', '3 people', SPLIT3,
               bn('mut', 'pause', 'The plan is paused', 'Ben paused spending at 14:20. Nothing can leave the pot until the group votes to resume.'),
               '<div class="dock mt12">' + btn('Record as paid by me', 'sec') + btn('Vote to resume', 'pri') + '</div>'))

def srow(k, name, on, amt, loc):
    c = f'<span class="cb{" on" if on else ""}">{ic("check", 16, 3) if on else ""}</span>'
    r = (amt if on else '<span class="mut">Not in this</span>')
    return li(c + av(k, 36), name, P[k]['city'], r, loc if on else '')

add('F', '23', 'Split editor',
    'Who shares this spend. Most people tap names; custom shares are there for couples and kids.',
    '21 → Split chips or the names line.',
    'Done → 21 with the new split.',
    'Everyone: all ticked, locked. Pick people (shown). Custom: each row gets a share stepper (×1, ×2) and amounts recalculate. Total must match, or Done is disabled.',
    ab('Split $18.00', sub='Tram passes', icon='x')
    + '<div class="seg"><span>Everyone</span><span class="on">Pick people</span><span>Custom</span></div>'
    + '<div class="mt8">'
    + srow('maya', 'Maya (you)', True, '$6.00', '£4.45') + srow('sam', 'Sam', True, '$6.00', '$6.00')
    + srow('asha', 'Asha', True, '$6.00', '₹502') + srow('ben', 'Ben', False, '', '')
    + '</div>'
    + '<div class="card t mt16"><div class="row sbw"><span class="lt">Custom shares</span><span class="chip sm ol">Try it</span></div>'
      '<p class="t13 mut" style="margin:6px 0 10px">Give someone a bigger share, like ×2 for a couple.</p>'
      f'<div class="row sbw">{av("asha", 28, flag=False)}<span class="t13 lm">Asha + partner</span><span class="stp"><i>−</i><b style="min-width:36px;text-align:center">×2</b><i>+</i></span></div></div>'
    + '<div class="sp"></div>'
    + f'<div class="row sbw t15 mt16"><span class="mut">Total</span><span class="b pos row" style="gap:6px">{ic("check", 18, 2.4)}$18.00 adds up</span></div>'
    + btn('Done', cls='mt12'))

add('F', '24', 'Spend done',
    'The receipt as a ticket stub. Everything a friend might ask is on it, in plain words, with Proof for the curious.',
    '21 after fingerprint; also 28 after approval.',
    'Done → 16 (the new item is at the top of the feed). Share → image of the stub.',
    'Settled time is measured, not fixed copy. If confirmation takes over 5 s it shows "Still confirming…" and never says Done early.',
    f'<div class="c mt16"><div class="bigic p">{ic("check", 36, 2.4)}</div><h2 class="d28 mt12">Paid</h2>'
    '<p class="t15 mut" style="margin:6px 16px 20px">Rossio Tram Kiosk got $18.00. Sam and Asha can see it now.</p></div>'
    + stub('<div class="row sbw"><span class="ov">Lisbon pot · receipt</span><span>🌊</span></div>'
           '<div class="hero mt8"><span class="d34">$18.00</span><span class="t17 m2">£13.36</span></div><div class="t15 b mt4">Tram passes</div>',
           [('To', 'Rossio Tram Kiosk'), ('Category', 'Transport'), ('Split', '3 people · $6.00 each'),
            ('Rule', 'Under $50 · went through now'), ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC'), ('When', 'Tue 13 Oct · 14:05')],
           f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}')
    + '<div class="sp"></div><div class="btns">' + btn('Share', 'sec', 'share') + btn('Done') + '</div>')

add('F', '25', 'Record something I paid myself',
    'For the card machine that only takes cards. Nothing moves now; it changes positions and evens out at settle-up.',
    '16 ⋯ → I paid for something; 22b split option; 22c.',
    'Record → 16 with "You paid $42 (recorded)" in the feed and your position updated.',
    'Counts against budgets like any spend. Can be questioned like any spend (30). Photo optional but nudged.',
    ab('I paid for something', sub='Lisbon, 12–16 Oct', icon='x')
    + bn('inf', 'info', 'No money moves now', 'This adds to what you\'re owed. It evens out when you settle up.')
    + '<div class="col mt16">' + field('What was it?', 'Groceries at Pingo Doce')
    + field('Amount', '£31.18', right='<span class="mono" style="color:var(--ink)">$42.00</span>') + '</div>'
    + '<div class="ov mt20">Category</div><div class="wrapc mt8">' + ''.join(chip(f'{e} {n}', 'on' if n == 'Food &amp; drink' else '') for e, n in CATS) + '</div>'
    + '<div class="ov mt20">Split</div><div class="wrapc mt8">' + chip('Everyone (4)', 'on') + chip('Pick people') + chip('Custom') + '</div>'
    + f'<div class="row mt8 t13">{avs(["maya", "sam", "asha", "ben"], 24)}<span class="mut">$10.50 each · you\'re owed <b class="pos">$31.50</b> more</span></div>'
    + f'<div class="row mt16"><span class="addph">{ic("camera", 22)}</span><div class="lm"><div class="lt">Add receipt photo</div><div class="t13 mut">Helps if anyone asks later</div></div></div>'
    + '<div class="mt12">' + field('When', 'Today, 11:30', right=ic('cal', 20)) + '</div>'
    + '<div class="sp"></div>' + btn('Record it'), h=960)

add('F', '26', 'Pay link created',
    'Pay someone outside the plan. They claim it in their own money; the link runs out in 7 days.',
    '20 → Send a pay link → 21 (amount, rules check) → fingerprint.',
    'Share link → share sheet. Cancel link → confirm → money back to the pot.',
    'States: not claimed (shown), claimed ("Inês claimed €38.73 · 15:12"), expired ("$45 is back in the pot").',
    ab('', icon='x')
    + f'<div class="c"><div class="bigic p">{ic("link", 32, 2.2)}</div><h2 class="d28 mt12">Pay link ready</h2>'
    '<p class="t15 mut" style="margin:6px 16px 20px">Send it to Inês. She claims it in euros. No app needed to start.</p></div>'
    + f'<div class="card"><div class="row">{av("ines", 44)}<div class="lm"><div class="lt">Inês</div><div class="t13 mut">Surfboard hire · Activities</div></div>'
      '<div class="lr"><span class="d22">$45.00</span><div class="t13 mut">€38.73</div></div></div>'
      '<div class="hr"></div>'
      f'<div class="row sbw"><span class="mono t13">plans.0xo.in/p/8fK2-wq</span><span class="ib f" style="width:40px;height:40px">{ic("copy", 18)}</span></div>'
      f'<div class="row sbw mt8 t13"><span class="row mut" style="gap:6px">{ic("clock", 16)}Expires in 7 days · Tue 20 Oct</span>'
      '<span class="chip sm">Not claimed yet</span></div></div>'
    + '<div class="mt12">' + bn('mut', 'info', 'Not claimed in 7 days?', 'The $45 goes back to the pot by itself.') + '</div>'
    + '<div class="sp"></div>' + btn('Share link', 'pri', 'share') + btn('Cancel link', 'txt', cls='mt4'))

# ------------------------------------------------------------------ G. Approve
REQ_BODY = (ab('', icon='x', right=ib('more'))
    + f'<div class="row">{av("asha", 48)}<div><div class="lt">Asha · Lisbon, 12–16 Oct</div><div class="t13 mut">Asked at 13:10 · expires in 22 h</div></div></div>'
    + '<h2 class="d28 mt16">Asha wants $250 for the boat trip</h2>'
    + '<div class="t17 m2 mt4">£185.57 · your share £46.39</div>'
    + '<div class="card t mt16"><p class="t15" style="margin:0">“Sunset boat, 3 hours, drinks included. They need it by 6pm to hold the slot.”</p></div>'
    + f'<div class="li mt8"><span class="thumb"><i></i></span><div class="lm"><div class="lt">Quote from Sunset Boats Lisboa</div><div class="t13 mut">Photo · only the plan can see it</div></div>{ic("chev", 20)}</div>'
    + '<div class="card mt8 col8 t13">'
    + '<div class="row sbw"><span class="mut">Category</span><span class="b">⛵ Activities</span></div>'
    + '<div class="row sbw"><span class="mut">Split</span><span class="b">Everyone · $62.50 each</span></div>'
    + '<div><div class="row sbw"><span class="mut">Activities after this</span><span class="b">$250 of $300</span></div><div class="bar mt4"><i style="width:83%;background:var(--ink)"></i></div></div>'
    + '<div class="row sbw"><span class="mut">Rule</span><span class="b">Over $200 needs 2 OKs</span></div>'
    + '</div>'
    + f'<div class="bn k-pos mt12"><span class="bi">{ic("check", 22, 2.4)}</span><div><b>Ben said OK</b><span>Yours makes 2 of 2, so it\'s paid straight away.</span></div></div>'
    + '<div class="sp"></div><div class="dock">' + btn('Reject', 'dngo') + btn('Approve', 'pri', 'fp') + '</div>')

add('G', '27', 'Approval request',
    'Opened from a push: "Asha wants $250 for the boat trip". Everything needed to decide, then two buttons.',
    'Push notification; Activity (52); waiting item in 16.',
    'Approve → fingerprint → 28. Reject → 27b.',
    'If someone else already decided, the screen shows the result instead of buttons. Expired: "This request ran out. Asha can ask again."',
    REQ_BODY, h=980)

add('G', '27b', 'Reject with a reason',
    'Added state. Rejecting asks for a short reason so it lands kindly.',
    '27 → Reject.',
    'Reject → Asha gets "Maya said no: Too expensive" with your note. Cancel → 27.',
    'Reason chip required; note optional (140 characters).',
    REQ_BODY,
    over=app_sheet('<h3 class="d22">Why not?</h3><p class="t13 mut" style="margin:6px 0 14px">Asha sees your reason. A kind word helps.</p>'
                   f'<div class="wrapc">{chip("Too expensive", "on")}{chip("Not what we agreed")}{chip("Wrong amount")}{chip("Let&#39;s talk first")}</div>'
                   '<div class="mt16">' + field('Note (optional)', 'Can we find one under $200?<span class="caret"></span>', 'on') + '</div>'
                   '<div class="btns mt16">' + btn('Cancel', 'sec') + btn('Reject', 'dng') + '</div>'), h=980)

add('G', '28', 'Approved and paid',
    'Your OK was the last one needed, so the money moved straight away. The timeline shows how it got here.',
    '27 → Approve → fingerprint.',
    'Done → 16. Proof opens the public record.',
    'If yours wasn\'t the last OK: "You said OK. Waiting for 1 more." with the timeline\'s next dot hollow.',
    ab('', icon='x')
    + f'<div class="c"><div class="bigic p">{ic("check", 36, 2.4)}</div><h2 class="d28 mt12">Approved and paid</h2>'
    '<p class="t15 mut" style="margin:6px 16px 16px">Sunset Boats Lisboa got $250.00. Asha knows.</p></div>'
    + '<div class="tline">'
    + '<div><div class="lt">Asha asked for $250</div><div class="t13 mut mono">13:10</div></div>'
    + '<div><div class="lt">Ben said OK</div><div class="t13 mut mono">13:22</div></div>'
    + '<div><div class="lt">You said OK</div><div class="t13 mut mono">14:05</div></div>'
    + '<div class="now"><div class="lt">Paid from the pot</div><div class="t13 mut mono">14:05 · settled in 0.6 s</div></div>'
    + '</div><div class="mt8"></div>'
    + stub('<div class="row sbw"><span class="ov">Lisbon pot · receipt</span><span>⛵</span></div>'
           '<div class="hero mt8"><span class="d34">$250.00</span><span class="t17 m2">£185.57</span></div><div class="t15 b mt4">Boat trip</div>',
           [('To', 'Sunset Boats Lisboa'), ('Approved', 'Ben, Maya · 2 of 2'), ('Split', 'Everyone · $62.50 each'), ('', 'Rate 1 GBP = 1.3472 USD · ECB 14:05 UTC')],
           f'<span class="zap">{ic("zap", 14, 2.2)}Settled in 0.6 s</span>{proof()}')
    + '<div class="sp"></div>' + btn('Done', cls='mt16'), h=920)
