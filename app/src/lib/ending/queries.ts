/** Extra indexer reads for the ending screens (fields the shared plan query doesn't carry). */
import { gql } from "../api/envio";

export type MemberLedger = { address: string; net: string; debt: string; pulled: string; debtPaid: string; withdrawn: string };

const Q_MEMBER_LEDGER = `query MemberLedger($pot: String!, $account: String!, $chainId: Int!) {
  Member(where: { pot_id: { _eq: $pot }, address: { _eq: $account }, chainId: { _eq: $chainId } }, limit: 1) {
    address net debt pulled debtPaid withdrawn
  }
}`;

export async function fetchMemberLedger(pot: string, account: string): Promise<MemberLedger | null> {
  return (await gql<{ Member: MemberLedger[] }>(Q_MEMBER_LEDGER, { pot: pot.toLowerCase(), account: account.toLowerCase() })).Member[0] ?? null;
}
