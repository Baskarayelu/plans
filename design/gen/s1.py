from base import *

def av_at(k, s, x, y):
    p = P[k]
    return (f'<span class="av" style="--c:{p["c"]};--s:{s}px;position:absolute;left:{x}px;top:{y}px;box-shadow:0 0 0 3px var(--bg)">'
            f'{p["i"]}<b>{p["f"]}</b></span>')

def band(color, text, top, left, rot):
    return (f'<div class="band" style="--w:{color};top:{top}px;left:{left}px;transform:rotate({rot}deg)">'
            f'<span>{text}</span><i></i><span>{text}</span></div>')

ILLO = ('<div class="illo">'
        + band(W['lagoon'], 'LISBON · 12–16 OCT · 4 PEOPLE', 34, -150, -11)
        + band(W['orchid'], 'GLASTONBURY CREW · 24–28 JUN', 118, -70, 6)
        + band(W['marigold'], "BEN'S 30TH · SAT 7 NOV", 200, -190, -5)
        + band(W['lime'], 'SKI WEEK · FEB · 6 PEOPLE', 280, -100, 8)
        + av_at('maya', 54, 36, 62) + av_at('sam', 46, 296, 30) + av_at('asha', 52, 262, 214) + av_at('ben', 44, 64, 256)
        + '</div>')

WELCOME = (f'<div class="row sbw" style="height:52px">{logo(22)}<span class="chip sm ol">English</span></div>'
           + ILLO +
           '<h1 class="d34" style="font-size:38px">One pot for the<br>whole plan.</h1>'
           '<p class="t17 mut mt12" style="margin-bottom:0">Friends anywhere chip in, spend under rules you agree, and settle up in one tap.</p>'
           '<div class="sp"></div>'
           + btn('Create account', 'pri', 'fp')
           + btn('I already use Plans', 'sec', cls='mt8')
           + '<p class="t13 mut c" style="margin:12px 0 0">No passwords. Your fingerprint is your key.</p>')

# ------------------------------------------------------------------ A. Start
add('A', '01', 'Welcome',
    'First screen after install. One clear choice: new account or restore.',
    'App launch with no account on this phone.',
    'Create account → 02. I already use Plans → 04.',
    'Default only. Language chip opens a picker. The bands are the brand moment: each one is a real plan colour.',
    WELCOME)

add('A', '02', 'Create passkey (system sheet)',
    'Android Credential Manager sheet over Welcome. Plans does not draw this; it shows what the user will see.',
    '01 → Create account.',
    'Fingerprint accepted → 03. Cancel → back to 01 with no account made. No passkey service → 06.',
    'Waiting for touch (shown). Fingerprint not recognised: system shakes and says "Try again". Uses Google Password Manager wording.',
    WELCOME, over=sys_sheet('create'))

add('A', '03', 'Name, country, currency',
    'The only form in sign-up. Country picks the local currency shown next to dollars everywhere.',
    '02 after the passkey is saved.',
    'Continue → 08 (empty home), or → 14 if they arrived from an invite link.',
    'Name required (1–30 characters). Country auto-guessed from the phone, editable. Currency follows country; "Change" for people who live abroad.',
    ab('', right='<span class="t13 mut" style="margin-right:12px">Step 2 of 2</span>')
    + bn('pos', 'shieldok', 'Your Plans account is ready', 'Your fingerprint is the key. There is no password to forget.')
    + '<h2 class="d28 mt24">What should friends call you?</h2>'
    + '<div class="col mt16">'
    + field('Your name', 'Maya<span class="caret"></span>', 'on')
    + field('Country', '🇬🇧 United Kingdom', right=ic('down', 20))
    + field('Town or city (optional)', 'London')
    + field('Your money', '£ Pound sterling (GBP)', right='Change',
            hint='We show pounds next to dollars. Friends see their own money.')
    + '</div>'
    + f'<div class="card t mt16"><div class="ov">How friends will see you</div><div class="row mt8">{av("maya", 44)}'
      '<div class="lm"><div class="lt">Maya</div><div class="t13 mut">London</div></div>'
      '<div class="lr">$40.00<div class="t13 mut">£29.69</div></div></div></div>'
    + '<div class="sp"></div>' + btn('Continue'))

add('A', '04', 'Restore: choose passkey (system sheet)',
    'Returning user on a new phone. Google Password Manager lists saved passkeys for plans.0xo.in.',
    '01 → I already use Plans.',
    'Continue + fingerprint → 05. Cancel → 01. No passkeys found → system says so; we show "Create account instead" on 01.',
    'One account: sheet skips the list and goes straight to fingerprint. Several accounts: list (shown). Another device: system QR flow.',
    WELCOME, over=sys_sheet('pick'))

add('A', '05', 'Restore success',
    'Confirms the account came back and everything was rebuilt from the same key.',
    '04 after fingerprint.',
    'Go to my plans → 07.',
    'Rebuilding (spinner rows) for up to ~2 s, then this. If a plan can\'t be loaded it shows "Try again" on that row only.',
    ab('', back=False)
    + f'<div class="bigic p mt8">{ic("check", 36, 2.4)}</div>'
    + '<h2 class="d28 c mt16">Welcome back, Maya</h2>'
    + '<p class="t15 mut c" style="margin:8px 12px 0">We found your Plans account and rebuilt everything.</p>'
    + '<div class="card mt24"><div class="ov">Back on this phone</div>'
    + li(emo('🌊', W['lagoon'], 44), 'Lisbon, 12–16 Oct', 'Active · 4 people', '<span class="pos">+£18.00</span>', 'owed to you')
    + li(emo('🎪', W['orchid'], 44), 'Glastonbury crew', 'Ended · 5 people', '<span class="neg">−£8.91</span>', 'you owe')
    + li(tile('ticket'), 'Your Plans account', 'Balance', '$5.00', '£3.71')
    + '</div>'
    + f'<div class="card t mt12"><div class="row">{fp()}</div>'
      '<p class="t13 mut" style="margin:10px 0 0">Same key as your other phone, so your receipts and notes open as normal.</p></div>'
    + '<div class="sp"></div>' + btn('Go to my plans'))

add('A', '06', 'Passkey not supported',
    'Plain recovery when the phone has no passkey service or it is switched off.',
    '02 or 04 when Credential Manager reports no provider or the call fails.',
    'Open settings → Android settings. Try again → 02/04. Back → 01.',
    'Variants: no screen lock set ("Set a screen lock first"), Android too old (no settings button).',
    ab('', icon='x')
    + f'<div class="bigic n mt8">{ic("key", 32, 2)}</div>'
    + '<h2 class="d28 c mt16">This phone can\'t save a passkey yet</h2>'
    + '<p class="t15 mut c" style="margin:8px 8px 0">Plans uses a passkey instead of a password. Your phone needs its passkey service turned on.</p>'
    + '<div class="card mt24 col">'
    + '<div class="step"><span class="n">1</span><div>Open <b>Settings</b>, then <b>Passwords &amp; accounts</b>.</div></div>'
    + '<div class="step"><span class="n">2</span><div>Under <b>Preferred service</b>, choose <b>Google Password Manager</b>.</div></div>'
    + '<div class="step"><span class="n">3</span><div>Check you have a screen lock or fingerprint set up.</div></div>'
    + '<div class="step"><span class="n">4</span><div>Come back here and tap <b>Try again</b>.</div></div>'
    + '</div>'
    + '<p class="t13 mut c mt12" style="margin-bottom:0">Needs Android 9 or newer with Google Play services.</p>'
    + '<div class="sp"></div>' + btn('Open settings') + btn('Try again', 'sec', cls='mt8'))

# ------------------------------------------------------------------ B. Home
def home_head(greet='Good afternoon, Maya'):
    return (f'<div class="row sbw" style="min-height:72px"><div><div class="t13 mut">{greet}</div><div class="d28">Your plans</div></div>'
            f'{av("maya", 44, flag=False)}</div>')

def bal_card(usd='$5.00', loc='£3.71', empty=False):
    b = (btn('Add money', 'pri', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm')) if empty else \
        (btn('Send', 'pri', 'send', 'sm') + btn('Add', 'sec', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm'))
    return (f'<div class="card"><div class="row sbw"><span class="ov">Your Plans account</span>{ic("chev", 18)}</div>'
            f'<div class="hero mt4"><span class="d34">{usd}</span><span class="t17 m2">{loc}</span></div>'
            f'<div class="btns mt12">{b}</div></div>')

TRY = ('<div class="card mt12" style="border:1.5px dashed var(--line);background:transparent">'
       f'<div class="row" style="align-items:flex-start">{tile("sparkle", "a")}<div class="lm"><div class="lt">Try a settle-up</div>'
       '<div class="t13 mut">A 2-minute trip with three demo friends. Test dollars only.</div></div>'
       f'<span class="mut">{ic("x", 20)}</span></div>'
       + btn('Start demo', 'sec', cls='sm mt12', style='width:100%') + '</div>')

LIS_CARD = ('<div class="pc">' + wb(W['lagoon'], 'Lisbon · 12–16 Oct · day 2 of 5') +
            f'<div class="pcb"><div class="row">{emo("🌊", W["lagoon"])}<div class="lm"><div class="d17">Lisbon, 12–16 Oct</div>'
            f'<div class="t13 mut">Pot $446.00 · £331.06</div></div>{avs(["maya", "sam", "asha", "ben"], 26)}</div>'
            '<div class="row sbw mt12"><span class="chip sm pos">You\'re owed £18.00</span>'
            '<span class="t13 mut row" style="gap:8px"><span class="dot"></span>Sam paid $36 · 2 min</span></div></div></div>')

GLA_CARD = ('<div class="pc mt12">' + wb(W['orchid'], 'Glastonbury crew · ended 28 Jun') +
            f'<div class="pcb"><div class="row">{emo("🎪", W["orchid"])}<div class="lm"><div class="d17">Glastonbury crew</div>'
            f'<div class="t13 mut">Settled · 5 people</div></div></div>'
            '<div class="row sbw mt12"><span class="chip sm neg">You owe £8.91</span>'
            f'<span class="t13 bb row" style="gap:2px">Pay now{ic("chev", 16, 2.2)}</span></div></div></div>')

add('B', '07', 'Home',
    'Everything at a glance: account balance, each plan with its wristband and your position, and a way in for judges.',
    'After sign-up or restore; Plans tab.',
    'Plan card → 16. Send → 43. Add → 18. Receive → 49. Pay now → 42. Start demo → 56. New plan → 10.',
    'Live dot shows the latest spend. Position chip: green "owed", red "you owe", grey "all square". "Try a settle-up" can be dismissed and comes back from You → Help.',
    home_head() + bal_card()
    + f'<div class="sec-h"><span class="d17">Plans</span><span class="row" style="gap:16px"><a>Join</a><a class="row" style="gap:2px;color:var(--ink)">{ic("plus", 16, 2.4)}New plan</a></span></div>'
    + LIS_CARD + GLA_CARD + TRY,
    tab='plans', h=880)

add('B', '08', 'Empty home',
    'First-run home. Two clear ways in: start a plan or join one.',
    'First sign-up (03), or after leaving every plan.',
    'New plan → 10. Join with a link or code → camera / paste. Start demo → 56.',
    'Balance $0.00 shows "Add money" first. Once a plan exists this becomes 07.',
    home_head('Welcome, Maya') + bal_card('$0.00', '£0.00', empty=True)
    + '<div style="position:relative;height:150px;margin:8px -16px 0;overflow:hidden">'
    + band(W['lagoon'], 'YOUR FIRST PLAN · YOUR FIRST PLAN', 40, -40, -6)
    + band(W['marigold'], 'FRIENDS · ANY COUNTRY · ONE POT', 86, -120, 4)
    + '</div>'
    + '<h2 class="d22 c">No plans yet</h2>'
    + '<p class="t15 mut c" style="margin:6px 8px 16px">Start a pot for a trip, a festival or a dinner. Friends join with one tap, from any country.</p>'
    + btn('New plan', 'pri', 'plus') + btn('Join with a link or code', 'sec', 'link', 'mt8') + TRY,
    tab='plans', h=880)

add('B', '09', 'Account balance detail',
    'Your own money, outside any plan. The one place (with Send) that names the digital dollar.',
    '07 balance card; You → Plans account.',
    'Add money → top-up options (55 on the test version). Receive → 49. Send → 43.',
    'Caption "Digital dollars (AUSD)" with an info tap: "1 digital dollar is always worth 1 US dollar." Safety-net holds are listed so the balance is never a surprise.',
    ab('Your Plans account')
    + '<div class="c mt8"><div class="ov">Balance</div><div class="d56 mt8">$5.00</div><div class="t17 m2 mt4">£3.71</div>'
      f'<div class="pill mt12">Digital dollars (AUSD){ic("info", 15, 2)}</div></div>'
    + '<p class="t13 mut c" style="margin:10px 24px 0">1 digital dollar is always worth 1 US dollar. Pounds use today\'s rate.</p>'
    + '<div class="btns mt20">' + btn('Add', 'pri', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm') + btn('Send', 'sec', 'send', 'sm') + '</div>'
    + '<div class="card mt20"><div class="ov">Held for your plans</div>'
    + li(emo('🌊', W['lagoon'], 40), 'Lisbon safety net', 'Only used if you owe at the end', 'up to $100', '£74.23', 'nb')
    + '</div>'
    + '<div class="sec-h"><span class="d17">Recent</span><a>See all</a></div>'
    + li(tile('in', 'p'), 'Added money', 'Tue 13 Oct · 09:12', '<span class="pos">+$20.00</span>', '£14.85')
    + li(tile('out'), 'To Lisbon pot', 'Mon 12 Oct · 18:40', '−$200.00', '£148.46')
    + li(tile('in', 'p'), 'From Ben · Manchester', 'Sun 11 Oct · 21:03', '<span class="pos">+$12.00</span>', '£8.91'),
    h=844)

# ------------------------------------------------------------------ C. Create & invite
EMOJIS = ''.join(f'<span class="et{" on" if e == "🌊" else ""}">{e}</span>' for e in ['🌊', '🎪', '🏔️', '🎂', '🏖️', '🍜', '🚐']) + f'<span class="et">{ic("plus", 20)}</span>'
SWATCH = ''.join(f'<span class="swc{" on" if k == "lagoon" else ""}" style="--w:{v}">{ic("check", 20, 2.6) if k == "lagoon" else ""}</span>' for k, v in W.items())

add('C', '10', 'Create plan: basics',
    'Name, emoji, wristband colour and dates. The card at the top previews exactly how the plan will look.',
    'Home → New plan.',
    'Next → 11. Close → discard (no confirm needed; nothing saved yet).',
    'Name required. Dates optional ("No end date" toggle in the picker). Without dates the plan ends when someone taps End plan.',
    ab('New plan', icon='x', right='<span class="t13 mut" style="margin-right:12px">1 of 2</span>')
    + '<div class="pc">' + wb(W['lagoon'], 'Lisbon · 12–16 Oct') +
      f'<div class="pcb"><div class="row">{emo("🌊", W["lagoon"])}<div class="lm"><div class="d17">Lisbon, 12–16 Oct</div>'
      '<div class="t13 mut">Just you so far</div></div></div></div></div>'
    + '<div class="col mt20">' + field('Plan name', 'Lisbon, 12–16 Oct<span class="caret"></span>', 'on') + '</div>'
    + f'<div class="ov mt20">Emoji</div><div class="row mt8" style="gap:6px">{EMOJIS}</div>'
    + f'<div class="ov mt20">Wristband colour</div><div class="row mt8" style="gap:10px">{SWATCH}</div>'
    + '<div class="mt20">' + field('Dates', 'Mon 12 Oct – Fri 16 Oct', right=ic('cal', 20),
                                  hint='The plan ends by itself on 17 Oct. You can end it sooner.') + '</div>'
    + '<div class="sp"></div>' + btn('Next: set the rules'))

def preset(title, desc, tiers, on=False, tag=''):
    t = ''.join(f'<span style="flex:{f};background:{c}">{l}</span>' for f, c, l in tiers)
    tg = f'<span class="chip sm acc">{tag}</span>' if tag else ''
    st = ' style="border:2px solid var(--ink)"' if on else ''
    return (f'<div class="card mt12"{st}><div class="row"><span class="rad{" on" if on else ""}"></span>'
            f'<span class="d17" style="flex:1">{title}</span>{tg}</div>'
            f'<p class="t13 mut" style="margin:8px 0 10px 34px">{desc}</p><div class="tiers" style="height:26px;margin-left:34px;font-size:11px">{t}</div></div>')

G, B_, Y = '#BFE3CF', '#BFD5EA', '#F8D892'
add('C', '11', 'Create plan: rules preset',
    'Three plain-language presets so most groups never touch a setting.',
    '10 → Next.',
    'Create plan → 13 (invite). Customise → 12.',
    'Balanced is preselected and labelled Recommended. The tier strip makes the difference visible at a glance.',
    ab('New plan', right='<span class="t13 mut" style="margin-right:12px">2 of 2</span>')
    + '<h2 class="d28">How careful should the pot be?</h2>'
    + '<p class="t15 mut" style="margin:8px 0 4px">Pick a starting point. The group can change it later with a vote.</p>'
    + preset('Easygoing', 'Spends up to $100 go through now. Bigger ones need 1 OK.', [(3, G, 'Now'), (1, B_, '1 OK')])
    + preset('Balanced', 'Up to $50 goes through now. $50–$200 needs 1 OK. Over $200 needs 2. Up to $300 a day.',
             [(1, G, 'Now'), (2, B_, '1 OK'), (1.4, Y, '2 OKs')], on=True, tag='Recommended')
    + preset('Strict', 'Every spend needs 1 OK. Over $100 needs everyone. Only members and saved businesses can be paid.',
             [(2, B_, '1 OK'), (2, Y, 'Everyone')])
    + f'<div class="li nb mt8">{tile("sliders")}<div class="lm"><div class="lt">Customise rules</div><div class="t13 mut">Budgets, daily cap, who can be paid</div></div>{ic("chev", 20)}</div>'
    + '<div class="sp"></div>' + btn('Create plan'), h=900)

def stepper(v):
    return f'<span class="stp"><i>−</i><b class="tnum" style="min-width:56px;text-align:center">{v}</b><i>+</i></span>'

def cat(e, name, amt):
    return f'<div class="li" style="min-height:56px"><span class="et sm">{e}</span><div class="lm"><div class="lt">{name}</div></div>{stepper(amt)}</div>'

add('C', '12', 'Customise rules',
    'Every rule on one screen, still in plain words. Used by organisers who want control.',
    '11 → Customise rules; later from 17 → Propose a change (then it becomes a vote, 35).',
    'Save rules → back to 11 with "Custom" selected.',
    'Limits must rise left to right; the strip shows an error if not. Turning off every payee type is blocked with a hint.',
    ab('Customise rules', right='<span class="btn txt sm" style="width:auto">Reset</span>')
    + '<div class="ov">Spend limits</div>'
    + f'<div class="tiers mt8"><span style="flex:1;background:{G}">Now</span><span style="flex:2;background:{B_}">1 OK</span><span style="flex:1.4;background:{Y}">2 OKs</span></div>'
    + '<div class="row sbw mono t11 mut mt4" style="padding:0 2px"><span>$0</span><span style="margin-left:-30px">$50</span><span style="margin-left:40px">$200</span><span>no max</span></div>'
    + '<div class="li mt8" style="min-height:56px"><div class="lm"><div class="lt">Daily cap</div><div class="t13 mut">Most the pot can spend in a day</div></div>' + stepper('$300') + '</div>'
    + '<div class="ov mt20">Budgets by category</div>'
    + cat('🛏️', 'Stay', '$300') + cat('🍽️', 'Food &amp; drink', '$120') + cat('🚋', 'Transport', '$80') + cat('⛵', 'Activities', '$300')
    + f'<div class="row t15 bb mt8" style="min-height:48px;gap:8px">{ic("plus", 20, 2.2)}Add a category</div>'
    + '<div class="ov mt16">Who can be paid</div>'
    + li('', 'People in the plan', 'Pay a friend back', toggle(True))
    + li('', 'Anyone, by link', 'They claim it in their own currency', toggle(True))
    + li('', 'Businesses', 'With a Plans code', toggle(True))
    + '<div class="ov mt16">Questioning spends</div>'
    + '<p class="t13 mut" style="margin:6px 0 8px">Anyone can question a spend for</p>'
    + f'<div class="row" style="gap:8px">{chip("24 hours")}{chip("48 hours", "on")}{chip("72 hours")}</div>'
    + '<div class="sp" style="min-height:16px"></div>' + btn('Save rules'), h=1060)

QR_LOGO = '<span class="logo" style="font-size:13px"><span class="lb"></span></span>'

add('C', '13', 'Invite friends',
    'Share the plan. The warning is short and sits right under the link.',
    '11 → Create plan; 17 → Invite.',
    'Share invite → Android share sheet. Done → 16.',
    'Link off: QR greys out with "Link turned off · Turn on". Expired: "Make a new link". Joined list updates live.',
    ab('', icon='x')
    + '<h2 class="d28">Invite friends to Lisbon</h2>'
    + '<p class="t15 mut" style="margin:8px 0 16px">They join with their fingerprint. No app yet? The link helps them install it first.</p>'
    + '<div class="pc">' + wb(W['lagoon'], 'Lisbon · 12–16 Oct · invite')
    + f'<div class="pcb c"><div style="display:inline-block;padding:10px;border-radius:18px;background:#fff">{qr("lis", 188, center=QR_LOGO)}</div>'
      f'<div class="row mt12" style="justify-content:center;gap:8px"><span class="mono t13">plans.0xo.in/j/lis-7Kq2</span><span class="ib f" style="width:40px;height:40px">{ic("copy", 18)}</span></div></div></div>'
    + '<div class="mt12">' + bn('acc', 'alert', 'Anyone with this link can join', 'Only share it with people on the trip. You can turn it off any time.') + '</div>'
    + f'<div class="row sbw mt12 t13"><span class="row mut" style="gap:6px">{ic("clock", 16)}Works for 7 days</span><span class="bb" style="text-decoration:underline">Turn off link</span></div>'
    + f'<div class="row mt16">{avs(["maya"], 32)}<span class="t13 mut">Maya (you) has joined. Waiting for friends.</span></div>'
    + '<div class="sp"></div><div class="btns">' + btn('Done', 'sec') + btn('Share invite', 'pri', 'share') + '</div>', h=900)

# ------------------------------------------------------------------ D. Join
def rule_line(t):
    return f'<div class="row" style="align-items:flex-start;gap:10px"><span class="pos" style="margin-top:1px">{ic("check", 18, 2.4)}</span><span class="t15">{t}</span></div>'

add('D', '14', 'Invite opened',
    'Everything a friend needs to decide: who is in, what the rules mean, what could be collected later. Shown here for Asha in Bengaluru.',
    'Invite link or QR. New users create an account first (01–03), then land back here.',
    'Join with fingerprint → system sheet → 15. Close → their home.',
    '"Add $20 now" is optional and off if the balance is $0 (shows "Add money first"). Rules collapse after 5 lines with "See all".',
    ab('', icon='x')
    + f'<div class="row t13 mut" style="gap:8px">{av("maya", 24, flag=False)}Maya invited you</div>'
    + '<div class="pc mt12">' + wb(W['lagoon'], 'Lisbon · 12–16 Oct · 5 days')
    + f'<div class="pcb"><div class="row">{emo("🌊", W["lagoon"])}<div class="lm"><div class="d22">Lisbon, 12–16 Oct</div>'
      '<div class="t13 mut">Pot so far $600.00 · ₹50,160</div></div></div>'
      f'<div class="row mt12" style="gap:14px">'
      + ''.join(f'<div class="c" style="width:76px">{av(k, 40)}<div class="t13 b mt4">{P[k]["n"]}</div><div class="t11 mut">{P[k]["city"]}</div></div>' for k in ['maya', 'sam', 'ben'])
      + '</div></div></div>'
    + '<div class="ov mt20">The rules, in plain words</div><div class="col8 mt8">'
    + rule_line('Spends up to $50 go through straight away.')
    + rule_line('$50–$200 needs one friend\'s OK. Over $200 needs two.')
    + rule_line('The pot can spend up to $300 a day.')
    + rule_line('Anyone can question a spend for 48 hours.')
    + rule_line('What\'s left is shared out when the trip ends.')
    + '</div>'
    + '<div class="card mt16"><div class="row"><div class="lm"><div class="lt">Add $20 now</div><div class="t13 mut">₹1,672 from your Plans account</div></div>' + toggle(True) + '</div>'
    + f'<div class="row mt12" style="gap:8px">{chip("$20", "on")}{chip("$50")}{chip("$100")}{chip("Other", "ol")}</div></div>'
    + '<div class="mt12">' + bn('inf', 'shield', 'Safety net', 'Up to $100 (₹8,360) can be collected from your Plans balance if you owe at the end. Never more, and we tell you first.') + '</div>'
    + '<div class="dock mt16">' + btn('Join with fingerprint', 'pri', 'fp') + '</div>', h=1180)

add('D', '14b', 'Invite no longer works',
    'Added state. A dead link should never look like a bug.',
    'Invite link that is expired, turned off, or for a plan that has ended.',
    'Ask for a new link → share sheet with a prefilled message. Go to my plans → 07/08.',
    'Copy changes by cause: turned off, older than 7 days, plan ended, plan full.',
    ab('', icon='x')
    + f'<div class="sp"></div><div class="bigic m">{ic("link", 32, 2)}</div>'
    + '<h2 class="d28 c mt16">This invite has stopped working</h2>'
    + '<p class="t15 mut c" style="margin:8px 12px 20px">Maya turned off the link, or it\'s more than 7 days old. Nothing was charged.</p>'
    + f'<div class="card"><div class="row">{emo("🌊", W["lagoon"])}<div class="lm"><div class="lt">Lisbon, 12–16 Oct</div><div class="t13 mut">Invite from Maya · London</div></div></div></div>'
    + '<div class="sp"></div>' + btn('Ask Maya for a new link', 'pri', 'share') + btn('Go to my plans', 'sec', cls='mt8'))

CONF = ''.join(
    f'<span class="conf" style="left:{x}px;top:{y}px;background:{c};transform:rotate({r}deg)"></span>'
    for x, y, c, r in [(30, 40, W['lagoon'], 20), (80, 110, W['marigold'], -30), (150, 30, W['orchid'], 45), (220, 90, W['lime'], -15),
                       (300, 50, W['coral'], 30), (340, 130, W['lagoon'], -40), (40, 170, W['iris'], 60), (260, 160, W['marigold'], 10),
                       (190, 140, W['coral'], -60), (120, 200, W['lime'], 35), (330, 220, W['orchid'], -20), (352, 300, W['marigold'], 70)])

add('D', '15', 'Joined',
    'A small celebration: your wristband is issued. Confirms money added and the safety net.',
    '14 after fingerprint.',
    'Open the plan → 16. Invite someone else → 13.',
    'If "Add now" was off, the first row reads "Add money any time". Others get a live "Asha joined" item in their feed.',
    f'<div style="position:absolute;inset:0;pointer-events:none">{CONF}</div>'
    + '<div style="height:120px"></div>'
    + f'<div class="band" style="--w:{W["lagoon"]};position:relative;width:auto;margin:0 -30px;transform:rotate(-4deg);justify-content:center">'
      '<span>ASHA · LISBON · 12–16 OCT</span><i></i></div>'
    + '<h2 class="d44 c mt32">You\'re in!</h2>'
    + '<p class="t17 mut c" style="margin:10px 12px 20px">Welcome to Lisbon, 12–16 Oct. Maya, Sam and Ben can see you\'ve joined.</p>'
    + '<div class="card">'
    + li(tile('check', 'p'), 'You added $20.00', '₹1,672 from your Plans account')
    + li(tile('shield', 'i'), 'Safety net is on', 'Up to $100 · ₹8,360, only if you owe at the end')
    + '</div>'
    + f'<div class="row mt16" style="justify-content:center">{avs(["maya", "sam", "ben", "asha"], 30)}<span class="t13 mut">4 people · 3 countries</span></div>'
    + '<div class="sp"></div>' + btn('Open the plan') + btn('Invite someone else', 'txt', cls='mt4'))
