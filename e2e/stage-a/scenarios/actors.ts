/** Throwaway test actors, generated fresh every run. Keys stay in memory and are never printed. */
import { type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { USD } from "../lib/plans";

const fresh = () => privateKeyToAccount(generatePrivateKey());

export interface Actors {
  alice: PrivateKeyAccount;
  bob: PrivateKeyAccount;
  carol: PrivateKeyAccount;
  dave: PrivateKeyAccount;
  erin: PrivateKeyAccount;
  frank: PrivateKeyAccount; // never joins Pot A: recipient of links and sends, the "non-member"
  gina: PrivateKeyAccount; // sender (PlansSend, send-by-link)
  hank: PrivateKeyAccount; // joins Pot A late with a safety-net permit (negative exit, pulled)
  kim: PrivateKeyAccount; // joins Pot A late with no money (negative exit, debt, payDebt before settle)
  ivy: PrivateKeyAccount; // no AUSD: creditor in Pot G (fresh balance slot for the gas test)
  judge: PrivateKeyAccount; // demo "try a settle-up" judge (holds 5 AUSD, like a judge who topped up)
  griefer: PrivateKeyAccount; // submits a gas-starved payDebt directly (MON only)
  rex: PrivateKeyAccount; // creditor in Pot H whom AUSD refuses for the whole run (always-refused recipient)
  shop: Address;
  stranger: Address;
  demo: { ben: PrivateKeyAccount; asha: PrivateKeyAccount; maya: PrivateKeyAccount };
  funded: Record<string, PrivateKeyAccount>;
  unfunded: Record<string, PrivateKeyAccount>;
  payees: Record<string, Address>;
  funding: Record<string, bigint>;
}

export function actorsFor(demo: Actors["demo"]): Actors {
  const funded = { alice: fresh(), bob: fresh(), carol: fresh(), dave: fresh(), erin: fresh(), frank: fresh(), gina: fresh(), hank: fresh(), judge: fresh(), rex: fresh() };
  const unfunded = { kim: fresh(), ivy: fresh() };
  const payees = { shop: fresh().address, stranger: fresh().address };
  return {
    ...funded,
    ...unfunded,
    griefer: fresh(),
    shop: payees.shop,
    stranger: payees.stranger,
    demo,
    funded,
    unfunded,
    payees,
    funding: { hank: USD(100), judge: USD(5), rex: USD(50) },
  };
}
