import base
from b2core import *
from b2a import shell, LIS, AUSD, site_top, site_facts
from b2b import NOT_SHOWN

SCR = {s['n']: s for s in base.SCREENS}


section('D', 'Shareable settle-up',
        'After settling, a card to share and a public page that proves it happened. Counts, countries and amounts only; the plan name and photos appear only if the sharer turns them on.')

item('D', '134', 'Share card · 1080 × 1350',
     'The card for stories and chats. Headline, flags with how many people from each country, the total put in, what went back out, and the time to settle. Rendered at real size.',
     '40/113 → Share → 136 → Save image or Share.',
     'Opens the proof page (137) when the link under it is tapped in a chat.',
     'Light and dark follow the sharer\'s app theme. With “Show the plan name” on, the plan name becomes the headline and this line moves under it. Counts are generated: “{n} friends · {c} countries”.',
     ('w', 1080, 0.42), share_portrait)

item('D', '135', 'Share card · 1200 × 630 (link preview)',
     'The image chats and social sites show when someone pastes plans.0xo.in/s/7kq2. Same facts, landscape.',
     'Served as the proof page\'s preview image.', '',
     'Never includes the plan name unless the sharer opted in. Cached per settle-up; changes if the sharer flips a toggle.',
     ('w', 1200, 0.6), share_land)


def share_sheet(theme):
    prev = f'<div style="zoom:.19;flex:none">{share_portrait(theme)}</div>'
    inner = ('<h3 class="d22">Share how it went</h3><p class="t13 mut" style="margin:4px 0 12px">Counts, countries and amounts. Names, notes and receipts are never on it.</p>'
             f'<div class="row" style="align-items:flex-start;gap:14px">{prev}<div class="lm">'
             '<div class="seg" style="padding:3px"><span class="on" style="height:34px;font-size:13px">Story</span><span style="height:34px;font-size:13px">Wide</span></div>'
             + li('', 'Show the plan name', 'Off: says “4 friends”', toggle(False))
             + li('', 'Show photos', 'Off: no pictures', toggle(False), cls='nb') + '</div></div>'
             + '<div class="card t mt12" style="padding:10px 12px"><div class="row sbw"><span class="mono t13">plans.0xo.in/s/7kq2</span><span class="t13 b">Preview</span></div></div>'
             + '<div class="btns mt12">' + btn('Copy link', 'sec', 'copy', 'sm') + btn('Save image', 'sec', 'download', 'sm') + '</div>'
             + btn('Share…', 'pri', 'share', 'mt8'))
    s = SCR['40']
    return aphone(theme, s['body'], h=s['h'], over=app_sheet(inner))


item('D', '136', 'Share sheet',
     'One sheet before the system share: pick the shape, decide about the name and photos (both off), copy or save. The preview is the real card.',
     '40 Settled → Share (and 113 on a laptop, where the same choices sit in the panel).',
     'Share… → Android share sheet with the image and link. Copy link → toast “Link copied”. Save image → Photos.',
     'Turning a toggle on asks once: “Everyone with the link will see the plan name.” Only the person who shares can turn it on for their link; other members\' links stay private.',
     'phone', share_sheet)


STATS = [('$800.00', 'put in together'), ('$687.60', 'spent on the trip'), ('$112.40', 'paid back out'), ('0.6 s', 'to settle up'), ('18', 'spends'), ('5 days', '12–16 Oct')]
COUNTRY = [('🇬🇧', '2 people in the UK', 'got £47.72'), ('🇺🇸', '1 person in the US', 'got $28.10'), ('🇮🇳', '1 person in India', 'got ₹1,674')]
PROOF_CARD = ('<div class="card"><div class="row sbw"><div><div class="lt">Settled on Monad</div><div class="t13 mut">Sat 17 Oct 2026 · 10:42 UTC</div></div>' + proof() + '</div>'
              '<p class="t13 mut" style="margin:8px 0 0">Every number on this page can be checked in public. Proof opens the settle-up on the Monad explorer.</p></div>')


def country_rows():
    return ''.join(li(f'<span style="font-size:28px;width:40px;text-align:center">{f}</span>', a, '', f'<span class="b">{b}</span>') for f, a, b in COUNTRY)


def proof_phone(opt=False):
    if opt:
        head = ('<h1 class="d34 mt16">Lisbon, 12–16 Oct</h1><p class="t15 mut" style="margin:6px 0 0">4 friends in 3 countries settled up in one tap.</p>'
                '<div class="row mt12" style="gap:8px">'
                + ''.join(f'<div style="flex:1;height:96px;border-radius:12px;display:grid;place-items:center;font-size:36px;background:linear-gradient(135deg,{a},{b})">{e}</div>'
                          for e, a, b in [('🌅', '#F5B83D', '#D9634B'), ('🚋', '#F7C862', '#2FA6B8'), ('⛵', '#2FA6B8', '#3C78B8')])
                + '</div><p class="t11 mut" style="margin:6px 0 0">Maya chose to show the plan name and 3 photos.</p>')
    else:
        head = '<h1 class="d34 mt16">4 friends in 3 countries settled up in one tap</h1>'
    return (f'<div class="webtop">{logo(20)}' + btn('Start a plan', 'pri', cls='sm', style='height:36px') + '</div>'
            + '<div class="bleed" style="margin-top:4px">' + wb(LIS, 'Settled · Sat 17 Oct 2026 · 4 people') + '</div>'
            + head
            + '<div class="card mt16" style="padding:4px 16px">' + country_rows() + '</div>'
            + '<div class="mt12" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
            + ''.join(f'<div class="card" style="padding:12px 14px"><div class="d22">{v}</div><div class="t13 mut">{l}</div></div>' for v, l in STATS) + '</div>'
            + '<div class="mt12">' + PROOF_CARD + '</div>'
            + ('' if opt else '<div class="mt12">' + NOT_SHOWN.replace('Only members see those, after they join.', 'The group kept those private.') + '</div>')
            + '<div class="sp" style="min-height:12px"></div>' + btn('Start your own plan', 'pri') + btn('What is Plans?', 'txt', cls='mt4'))


item('D', '137', 'Public proof page: phone',
     'What a friend-of-a-friend sees from the card: how many people, from where, what each country got back, the totals and the settle time, with Proof.',
     'plans.0xo.in/s/7kq2 from the card, a chat preview or a post.',
     'Proof → the settle-up on the Monad explorer (new tab). Start your own plan → 01 or /download. What is Plans? → landing.',
     'Default: name and photos hidden (shown). Opt-in on → 139. Sharer turns sharing off → “This summary is no longer shared.” Built from the public record by the indexer; no member data.',
     'phone', lambda t: mphone(t, proof_phone(), h=1230, kind='safari', url='plans.0xo.in'))


def proof_lap():
    left = ('<div style="width:640px"><div style="border-radius:10px;overflow:hidden">' + wb(LIS, 'Settled · Sat 17 Oct 2026 · 4 people') + '</div>'
            '<h1 class="d56 mt16" style="font-size:60px">4 friends in 3 countries settled up in one tap</h1>'
            '<div class="mc mt20" style="padding:4px 16px">' + country_rows() + '</div>'
            '<div class="mt12">' + PROOF_CARD + '</div></div>')
    right = ('<div style="width:420px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
             + ''.join(f'<div class="mc"><div class="d28">{v}</div><div class="t13 mut">{l}</div></div>' for v, l in STATS) + '</div>'
             '<div class="mt12">' + NOT_SHOWN.replace('Only members see those, after they join.', 'The group kept those private.') + '</div>'
             '<div class="mc mt12 row"><div class="lm"><div class="lt">Planning something?</div><div class="t13 mut">One pot, rules you agree, settled in one tap.</div></div>'
             + btn('Start a plan', 'pri', cls='sm') + '</div></div>')
    return (f'<div style="flex:1;display:flex;flex-direction:column">{site_top(btn("Start a plan", "pri", cls="sm"))}'
            f'<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:64px;padding:0 48px">{left}{right}</div>{site_facts()}</div>')


item('D', '138', 'Public proof page: laptop',
     'The same page at desktop width: the story and Proof on the left, the numbers and what\'s private on the right.',
     'plans.0xo.in/s/7kq2 in a desktop browser.', 'As 137.', 'As 137.',
     'lap', lambda t: lap(t, 'plans.0xo.in/s/7kq2', proof_lap()))

item('D', '139', 'Public proof page with name and photos (opt-in)',
     'Only when the sharer turned both toggles on: the plan name becomes the headline and up to 3 photos they picked appear. It says who chose to show them.',
     '136 with “Show the plan name” and “Show photos” on.',
     'As 137. The sharer can turn it back off from the plan\'s ⋯ menu; the page reverts to 137 within a minute.',
     'Photos are re-encrypted for public view only when the sharer opts in; receipts are never eligible.',
     'phone', lambda t: mphone(t, proof_phone(True), h=1380, kind='safari', url='plans.0xo.in'))

# ================================================================== E. Agora backing
BACKING = ('<div class="card mt16"><div class="row" style="align-items:flex-start">' + tile('shieldok', 'p')
           + '<div class="lm"><div class="lt">Backed 1:1 by cash and US Treasuries</div>'
             '<div class="t13 mut">Digital dollars (AUSD) are issued by Agora. Each one is backed by a dollar held in cash or short-term US Treasuries.</div></div></div>'
           '<div class="hr"></div><div class="col8 t13">'
           '<div class="row sbw"><span class="mut">Reserves report</span><span class="b">Agora · as of 30 Sep 2026</span></div>'
           '<div class="row sbw"><span class="mut">Checked by</span><span class="b">Independent accountant</span></div>'
           '<div class="row sbw"><span class="mut">Fetched</span><span class="b">Today 14:00 UTC · agora.finance</span></div></div>'
           f'<div class="row sbw mt12"><span class="t13 b row" style="gap:4px">See the report{ic("out", 14, 2.2)}</span><span class="t13 mut">What could go wrong</span></div></div>')


def balance2():
    return (ab('Your Plans account')
            + '<div class="c mt8"><div class="ov">Balance</div><div class="d56 mt8">$5.00</div><div class="t17 m2 mt4">£3.71</div>'
              f'<div class="pill mt12">Digital dollars (AUSD){ic("info", 15, 2)}</div></div>'
            + '<p class="t13 mut c" style="margin:10px 24px 0">1 digital dollar is always meant to be worth 1 US dollar. Pounds use today\'s rate.</p>'
            + '<div class="btns mt20">' + btn('Add', 'pri', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm') + btn('Send', 'sec', 'send', 'sm') + '</div>'
            + BACKING
            + '<div class="card mt12"><div class="ov">Held for your plans</div>'
            + li(emo('🌊', W['lagoon'], 40), 'Lisbon safety net', 'Only used if you owe at the end', 'up to $100', '£74.23', 'nb') + '</div>'
            + '<div class="sec-h"><span class="d17">Recent</span><a>See all</a></div>'
            + li(tile('in', 'p'), 'Added money', 'Tue 13 Oct · 09:12', '<span class="pos">+$20.00</span>', '£14.85')
            + li(tile('out'), 'To Lisbon pot', 'Mon 12 Oct · 18:40', '−$200.00', '£148.46'))


section('E', 'What backs the dollar',
        'The balance screen says who issues the digital dollar, what backs it, and where the latest reserves report comes from, with its date.')

item('E', '140', 'Balance with backing (09, revised)',
     'Screen 09 gains one card: issuer, backing, the latest reserves report with its date, who checked it, and when we fetched it, linking to the source.',
     '07 balance card; You → Your Plans account; the AUSD pill anywhere.',
     'See the report → Agora\'s page in the browser. What could go wrong → 147. AUSD pill → 141.',
     'Report date and fetch time come from Agora\'s public data through the relayer (sample shown). If it can\'t be fetched: “Couldn\'t load the latest report · Try again” and the last known date, never a made-up one. Copy “always meant to be worth” replaces “always worth”.',
     'phone', lambda t: aphone(t, balance2(), h=1040))


def backing_sheet():
    q = [('What is it?', 'A digital dollar. Plans holds your money as AUSD so friends in any country share one currency.'),
         ('Who issues it?', 'Agora, a company that issues AUSD and publishes reports on its reserves.'),
         ('What backs it?', 'Cash and short-term US Treasuries, one dollar for each digital dollar, according to Agora\'s reserves report.'),
         ('Can anything go wrong?', 'Agora can freeze an account or pause transfers. Plans can\'t override that.')]
    return ('<h3 class="d22">About digital dollars</h3>'
            + ''.join(f'<div class="mt12"><div class="lt">{a}</div><p class="t15 mut" style="margin:2px 0 0">{b}</p></div>' for a, b in q)
            + '<div class="card t mt16 mono t11" style="line-height:1.7">Source: Agora · reserves report as of 30 Sep 2026<br>Fetched today 14:00 UTC</div>'
            + '<div class="btns mt16">' + btn('What could go wrong', 'sec', 'shield') + btn('Got it', 'pri') + '</div>')


item('E', '141', 'About digital dollars (sheet)',
     'Four plain questions from the AUSD pill, with the uncomfortable one answered honestly and a way to read more.',
     'AUSD pill on 09/140, Send (43, 45) and 142.',
     'What could go wrong → 147. Got it → closes.',
     'The source line always shows the report date and fetch time.',
     'phone', lambda t: aphone(t, balance2(), h=1040, over=app_sheet(backing_sheet())))


def acct_main():
    return ('<div class="mh"><div><div class="t15 mut">You</div><h1 class="d44">Your Plans account</h1></div>'
            '<div class="btns">' + btn('Add', 'pri', 'plus', 'sm') + btn('Receive', 'sec', 'qr', 'sm') + btn('Send', 'sec', 'send', 'sm') + '</div></div>'
            '<div class="g2c mt20" style="align-items:stretch">'
            '<div class="mc" style="padding:24px"><div class="ov">Balance</div><div class="hero mt8"><span class="d56">$5.00</span><span class="t17 m2">£3.71</span></div>'
            f'<div class="mt12">{AUSD}</div><p class="t13 mut" style="margin:10px 0 0">1 digital dollar is always meant to be worth 1 US dollar. Pounds use today\'s rate.</p></div>'
            '<div class="mc"><div class="ov">Held for your plans</div>'
            + li(emo('🌊', W['lagoon'], 40), 'Lisbon safety net', 'Only used if you owe at the end', 'up to $100', '£74.23', 'nb') + '</div></div>'
            '<div class="row sbw mt24"><span class="d22">Recent</span><span class="t13 b mut">Download CSV</span></div>'
            '<div class="mc mt8" style="padding:2px 16px">'
            + li(tile('in', 'p'), 'Added money', 'Tue 13 Oct · 09:12', '<span class="pos">+$20.00</span>', '£14.85')
            + li(tile('out'), 'To Lisbon pot', 'Mon 12 Oct · 18:40', '−$200.00', '£148.46')
            + li(tile('in', 'p'), 'From Ben · Manchester', 'Sun 11 Oct · 21:03', '<span class="pos">+$12.00</span>', '£8.91')
            + li(tile('out'), 'To Sam · New York', 'Sat 10 Oct · 08:30', '−$2.02', '£1.50') + '</div>')


def acct_side():
    return ('<div class="d22">What backs it</div>' + BACKING.replace('card mt16', 'card mt12')
            + '<div class="mt12 card t"><div class="lt">Can anything go wrong?</div><p class="t13 mut" style="margin:4px 0 0">Agora can freeze an account or pause transfers, and Plans can\'t override that. Read what that means for your plans.</p>'
            + btn('What could go wrong', 'sec', 'shield', 'sm mt12') + '</div>')


item('E', '142', 'Balance with backing: laptop',
     'The account page on a laptop, with the backing panel on the right so it\'s read alongside the balance rather than hidden behind an icon.',
     'You → Your Plans account; the rail balance card.',
     'See the report → Agora (new tab). What could go wrong → 148.',
     'Same fetch rules as 140.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/you/account', shell('you', acct_main(), acct_side())))

# ================================================================== F. What could go wrong
TOPICS = [
    ('phone', 'If you lose your phone', 'Your passkey comes back if it was synced. If it wasn\'t, nothing can bring the account back.', '144'),
    ('users', 'If someone won\'t pay', 'The pot and the safety net cover most of it. Plans can\'t collect beyond that.', '145'),
    ('wifioff', 'If Plans\' service is down', 'Money stays in the pot. Paying and settling wait, or can be sent directly.', '146'),
    ('ban', 'If the digital dollar is frozen', 'Agora can freeze or pause AUSD. Plans can\'t override it.', '147'),
]


def wcg_overview():
    rows = ''.join(f'<div class="card mt8"><div class="row" style="align-items:flex-start">{tile(i, "n" if k == "147" else "i")}<div class="lm"><div class="lt">{t}</div>'
                   f'<div class="t13 mut">{d}</div></div>{ic("chev", 20)}</div></div>' for i, t, d, k in TOPICS)
    return (ab('What could go wrong')
            + '<h2 class="d28">The uncomfortable parts, in plain words</h2>'
            + '<p class="t15 mut" style="margin:8px 0 8px">Plans is built so money only moves by your group\'s rules. Here\'s what that protects you from, and what it doesn\'t.</p>'
            + rows
            + '<div class="card t mt16"><div class="row">' + tile('book') + '<div class="lm"><div class="lt">Your plan\'s rules</div><div class="t13 mut">Lisbon · Balanced</div></div>' + ic('chev', 20) + '</div></div>'
            + '<div class="sp"></div><p class="t13 mut c" style="margin:0">Something else? You → Help. We answer within a day.</p>')


def detail(icon, kind, title, summary, yes, no, todo, btns_html):
    return (ab('', sub='What could go wrong', icon='back')
            + f'<div class="bigic {kind}" style="margin:0;width:56px;height:56px">{ic(icon, 26, 2)}</div>'
            + f'<h2 class="d28 mt12">{title}</h2><p class="t15" style="margin:8px 0 14px">{summary}</p>'
            + f'<div class="prot y"><h5>{ic("check", 14, 2.6)}What protects you</h5><ul>' + ''.join(f'<li>{x}</li>' for x in yes) + '</ul></div>'
            + f'<div class="prot n mt8"><h5>{ic("x", 14, 2.6)}What doesn\'t</h5><ul>' + ''.join(f'<li>{x}</li>' for x in no) + '</ul></div>'
            + (f'<div class="ov mt16">What to do</div><p class="t15" style="margin:4px 0 0">{todo}</p>' if todo else '')
            + '<div class="sp" style="min-height:12px"></div>' + btns_html)


LOST = dict(icon='phone', kind='i', title='If you lose your phone',
            summary='Your passkey is your key. If it was saved to Google Password Manager or iCloud Keychain, it comes back on a new phone with everything in it.',
            yes=['Sign in to a new phone with the same Google account, open Plans and tap “I already use Plans”.',
                 'Whoever has your phone still needs your fingerprint or screen lock to spend or approve.',
                 'Anyone in your plan can pause spending for 24 hours while you sort it out.'],
            no=['If you also lose your Google account, Plans can\'t bring your account back. Nobody can, including us.',
                'There\'s no group recovery yet. Money due to a lost account is paid to that account at settle-up, where no one can reach it.'],
            todo='Check now that your passkey is saved somewhere that syncs: You → Devices with your passkey.')
WONT = dict(icon='users', kind='i', title='If someone won\'t pay',
            summary='Most of the money is in the pot before anyone spends, so there\'s usually little to chase at the end.',
            yes=['Money in the pot follows the rules, not anyone\'s goodwill.',
                 'Safety net: if someone owes at the end, up to $100 is collected from their Plans account, if it\'s there.',
                 'Any spend can be questioned for 48 hours. The group votes, and the spender can be made to cover it.',
                 'Anything still owed is shown to the whole plan, and can be paid in one tap.'],
            no=['Plans can\'t collect more than the safety net, or from an empty account.',
                'We don\'t chase debts, add interest or report anyone. That part is between friends.'],
            todo='')
DOWN = dict(icon='wifioff', kind='i', title='If Plans\' service is down',
            summary='Plans sends what you confirm to Monad and pays the network cost for you. If that service stops, your money doesn\'t go anywhere.',
            yes=['Money stays in the pot. Nobody, including Plans, can move it outside your group\'s rules.',
                 'Balances, spends and receipts can still be read from the public record.',
                 'The pot checks every request itself, so a delayed one can\'t be changed on the way.'],
            no=['Paying, approving and settling wait until it\'s back, unless someone sends them to Monad directly. That\'s advanced, costs a few cents, and the guide is in Help.',
                'New invites and pay links can\'t be opened until it\'s back.'],
            todo='Nothing, usually. We show a banner while it\'s down and when it\'s back.')
FREEZE = dict(icon='ban', kind='n', title='If the digital dollar is frozen',
              summary='Plans holds money as digital dollars (AUSD) issued by Agora. Like other dollar-backed digital dollars, the issuer can freeze an account or pause all transfers, for example on a court order.',
              yes=['One frozen person doesn\'t stop the plan. At settle-up their payout is set aside as their claim, and everyone else is paid.',
                   'A pause doesn\'t take money away. It\'s still there when the pause ends.',
                   'Agora publishes reports on what backs AUSD. The latest is on your balance screen.'],
              no=['Plans can\'t override a freeze or a pause.',
                  'If Agora paused all transfers, no one could spend, settle or send until it ended.'],
              todo='')


section('F', 'What could go wrong',
        'One honest screen, reachable from You and from every plan\'s Members & rules. “Making something simple should not mean making the uncomfortable parts disappear.”')

item('F', '143', 'What could go wrong: overview',
     'Four things people worry about, each with a one-line answer that already says what isn\'t covered.',
     'You → What could go wrong (53, 118); Members &amp; rules → What could go wrong (149); 140/141 links; restore failures (106).',
     'Each row → 144–147. Your plan\'s rules → 17.',
     'Same content in every plan; the rules row names the plan you came from.',
     'phone', lambda t: aphone(t, wcg_overview()))

for n, d, entry in [('144', LOST, 'Pause a plan'), ('145', WONT, 'See the rules'), ('146', DOWN, 'Open Help'), ('147', FREEZE, 'About digital dollars')]:
    sec_btn = {'144': btn('Check my passkey', 'pri', 'key') + btn('Pause a plan', 'sec', 'pause', 'mt8'),
               '145': btn('See Lisbon\'s rules', 'pri', 'book'),
               '146': btn('Help: sending directly', 'sec', 'help'),
               '147': btn('About digital dollars', 'sec', 'info')}[n]
    body = detail(d['icon'], d['kind'], d['title'], d['summary'], d['yes'], d['no'], d['todo'], sec_btn)
    caps = {
        '144': ('Lost phone: what syncs, how to restore, and the hard truth that without the account behind the passkey nothing comes back.',
                'Check my passkey → You → Devices. Pause a plan → 33.',
                'Copy names iCloud Keychain on iPhone/Mac. Group recovery is not in the contracts; this says so instead of implying it.'),
        '145': ('A member who won\'t pay: the pot, the safety net, disputes and recorded debts, and where Plans stops.',
                'See the rules → 17.',
                'The $100 safety net and 48-hour window come from the plan\'s rules, so the numbers change per plan.'),
        '146': ('The relayer being down, in plain words: money stays put, reading still works, actions wait or can be sent directly.',
                'Help: sending directly → Help article (advanced).',
                'While down, a banner on 07/16 links here.'),
        '147': ('Issuer freeze risk, stated plainly: Agora can freeze or pause, Plans can\'t override, and one frozen payout doesn\'t block the others.',
                'About digital dollars → 141.',
                'No reassurance we can\'t back up: no claims about how often freezes happen.'),
    }[n]
    item('F', n, d['title'], caps[0], '143.', caps[1], caps[2], 'phone', (lambda b: lambda t: aphone(t, b, h=1000))(body))


def wcg_lap_main():
    cells = []
    for d in (LOST, WONT, DOWN, FREEZE):
        cells.append(f'<div class="mc"><div class="row">{tile(d["icon"], "n" if d is FREEZE else "i")}<div class="d17">{d["title"]}</div></div>'
                     f'<div class="prot y mt12" style="font-size:13px;padding:10px 12px"><h5>{ic("check", 13, 2.6)}Protects you</h5>{d["yes"][0]}</div>'
                     f'<div class="prot n mt8" style="font-size:13px;padding:10px 12px"><h5>{ic("x", 13, 2.6)}Doesn\'t</h5>{d["no"][0]}</div>'
                     f'<div class="t13 b mt8">Read the full answer →</div></div>')
    return ('<div class="mh"><div><div class="t15 mut">You</div><h1 class="d44">What could go wrong</h1></div></div>'
            '<p class="t17 mut" style="margin:6px 0 16px;max-width:700px">Money only moves by your group\'s rules. Here\'s what that protects you from, and what it doesn\'t.</p>'
            f'<div class="g2c" style="gap:14px">{"".join(cells)}</div>')


def wcg_lap_side():
    return ('<div class="d22">If you lose your phone</div>'
            f'<p class="t15" style="margin:8px 0 12px">{LOST["summary"]}</p>'
            '<div class="ov">What to do now</div><div class="col8 mt8 t15">'
            '<div class="step"><span class="n">1</span><div>Check where your passkey is saved: You → Devices.</div></div>'
            '<div class="step"><span class="n">2</span><div>If it only lives on one phone, save one on this computer too.</div></div>'
            '<div class="step"><span class="n">3</span><div>Lost it? Ask anyone in the plan to pause spending.</div></div></div>'
            '<div class="sp"></div>' + btn('Check my passkey', 'pri', 'key') + btn('Read the full answer', 'sec', cls='mt8'))


item('F', '148', 'What could go wrong: laptop',
     'All four answers side by side, two lines each of what protects you and what doesn\'t. Picking one opens the full answer in the panel.',
     'You → What could go wrong (118); Members &amp; rules in a plan.',
     'Card → full answer in the panel (shown for a lost phone). Check my passkey → You → Devices.',
     'Full text matches 144–147 word for word.',
     'lap', lambda t: lap(t, 'plans.0xo.in/app/you/risks', shell('you', wcg_lap_main(), wcg_lap_side())))


def members_rules():
    rules = [('zap', 'Up to $25 goes through now.'), ('users', '$25–$200 needs 1 OK. Over $200 needs 3 of 4.'),
             ('cal', 'Each person can spend up to $150 a day.'), ('receipt', 'Budgets: Stay $300, Food &amp; drink $120, Getting around $80, Tickets &amp; activities $300.'),
             ('scale', 'Anyone in a split can question a spend for 48 hours.'), ('shield', 'Safety net: up to $100 each if someone owes at the end.')]
    return (ab('Members &amp; rules', sub='Lisbon, 12–16 Oct', right=ib('plus'))
            + '<div class="ov">4 people · 3 countries</div>'
            + li(av('maya', 40), 'Maya (you)', 'London · put in $200.00', '<span class="pos">+£18.00</span>', 'owed to you')
            + li(av('sam', 40), 'Sam', 'New York · put in $200.00', '$0.00', 'all square')
            + li(av('asha', 40), 'Asha', 'Bengaluru · put in $200.00', '<span class="neg">−₹676</span>', 'owes · £6.00')
            + li(av('ben', 40), 'Ben', 'Manchester · put in $200.00', '<span class="neg">−£12.00</span>', 'owes')
            + '<div class="row sbw mt20"><span class="ov">Rules · Balanced</span><span class="t13 mut">Agreed 12 Oct</span></div>'
            + '<div class="card mt8 col">' + ''.join(f'<div class="row" style="align-items:flex-start;gap:12px"><span class="mut">{ic(i, 20)}</span><span class="t15">{t}</span></div>' for i, t in rules) + '</div>'
            + f'<div class="card t mt12" style="box-shadow:0 0 0 2px var(--accent)"><div class="row">{tile("shield", "i")}<div class="lm"><div class="lt">What could go wrong</div>'
              f'<div class="t13 mut">Lost phones, people who won\'t pay, outages, freezes</div></div>{ic("chev", 20)}</div></div>'
            + '<div class="sp" style="min-height:16px"></div><div class="btns">' + btn('Pause spending', 'dngo', 'pause') + btn('Propose a change', 'sec', 'edit') + '</div>')


item('F', '149', 'Entry point in Members &amp; rules (17, revised)',
     'Screen 17 with the rules from the protocol and a “What could go wrong” row under them, outlined in marigold for this review only. You (53) gets the same row above Help.',
     '16 → people icon or Rules.', 'What could go wrong → 143.',
     'Rule lines now match docs/protocol.md Balanced ($25 / $200 / 3 of 4 / $150 a day each) and its category names.',
     'phone', lambda t: aphone(t, members_rules(), h=960))
