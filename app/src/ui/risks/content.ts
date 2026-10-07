/**
 * "What could go wrong" (designs 143–147): the uncomfortable parts, in plain words.
 * Each answer says what protects you and, just as plainly, what doesn't.
 */
import type { IconName } from "../Icon";

export type RiskTopicId = "lost-phone" | "wont-pay" | "service-down" | "frozen";

export type RiskTopic = {
  id: RiskTopicId;
  icon: IconName;
  kind: "i" | "n";
  title: string;
  /** One line for the overview (143). */
  line: string;
  summary: string;
  yes: string[];
  no: string[];
  todo?: string;
};

/** 147's button to 141 (kept with the 147 copy). */
export const ABOUT_DOLLARS_LABEL = "About digital dollars";

export const WITHOUT_SERVICE_GUIDE_URL = "https://plans.0xo.in/docs/without-the-relayer";

export const RISK_TOPICS: RiskTopic[] = [
  {
    id: "lost-phone",
    icon: "phone",
    kind: "i",
    title: "If you lose your phone",
    line: "Your passkey comes back if it was synced. If it wasn't, nothing can bring the account back.",
    summary: "Your passkey is your key. If it was saved to Google Password Manager, it comes back on a new phone with everything in it.",
    yes: [
      "Sign in to a new phone with the same Google account, open Plans and tap “I already use Plans”.",
      "Your plans, money and receipts come back with it, and your key fingerprint stays the same.",
      "Whoever has your phone still needs your fingerprint or screen lock to spend or approve.",
      "Anyone in your plan can pause spending for 24 hours while you sort it out.",
    ],
    no: [
      "If your passkey lived only on the lost phone, or you also lose your Google account, Plans can't bring your account back. Nobody can, including us.",
      "There's no group recovery yet. Money due to a lost account is still paid to that account at settle-up, where no one can reach it.",
      "Things kept only on the old phone, like your app settings, start fresh.",
    ],
    todo: "Check now that your passkey is saved somewhere that syncs: You → Phones with your passkey.",
  },
  {
    id: "wont-pay",
    icon: "users",
    kind: "i",
    title: "If someone won't pay",
    line: "The pot and the safety net cover most of it. Plans can't collect beyond that.",
    summary: "Most of the money is in the pot before anyone spends, so there's usually little to chase at the end.",
    yes: [
      "Money in the pot follows the rules, not anyone's goodwill.",
      "Safety net: if someone owes at the end, up to their safety net is collected from their Plans account, if the money is there.",
      "Any spend can be questioned for 48 hours. The group votes, and the spender can be made to cover it.",
      "Anything still owed is shown to the whole plan, and can be paid in one tap.",
      "After settle-up, if a payout couldn't be delivered (for example, the issuer froze that member's account), it stays reserved for them. Anyone can collect it for them later, and it can only ever be paid to that member.",
    ],
    no: ["Plans can't collect more than the safety net, or from an empty account.", "We don't chase debts, add interest or report anyone. That part is between friends."],
  },
  {
    id: "service-down",
    icon: "wifioff",
    kind: "i",
    title: "If Plans' service is down",
    line: "Money stays in the pot and nothing can be lost. Paying and settling wait, or can be sent directly.",
    summary: "Plans sends what you confirm to Monad and pays the network cost for you. If that service stops, your money doesn't go anywhere.",
    yes: [
      "Money stays in the pot. Nobody, including Plans, can move it outside your group's rules.",
      "Nothing can be lost. Something that didn't go through simply didn't happen, and you can do it again later.",
      "The pot checks every request itself, so a delayed one can't be changed on the way.",
      "Balances and spends can still be read from the public record.",
    ],
    no: [
      "Paying, approving and settling wait until it's back, unless someone sends them to Monad directly. That's advanced and costs a few cents; the guide below shows how.",
      "New invites and pay links can't be opened until it's back.",
    ],
    todo: "Nothing, usually. Wait a little and try again.",
  },
  {
    id: "frozen",
    icon: "ban",
    kind: "n",
    title: "If the digital dollar is frozen",
    line: "Agora can freeze or pause AUSD. Plans can't override it.",
    summary:
      "Plans holds money as digital dollars (AUSD) issued by Agora. Like other dollar-backed digital dollars, the issuer can freeze an account or pause all transfers, for example on a court order.",
    yes: [
      "One frozen person doesn't stop the plan. At settle-up their payout is reserved for them, and everyone else is paid.",
      "A reserved payout can only ever be paid to that member. Anyone can collect it for them later, for example once the freeze is lifted.",
      "A pause doesn't take money away. It's still there when the pause ends.",
      "Agora publishes reports on what backs AUSD. The latest is on your balance screen.",
    ],
    no: ["Plans can't override a freeze or a pause.", "If Agora paused all transfers, no one could spend, settle or send until it ended."],
  },
];

export function riskTopic(id?: string): RiskTopic | undefined {
  return RISK_TOPICS.find((t) => t.id === id);
}
