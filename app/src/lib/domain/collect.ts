/** Money a settled pot still owes members (Pot.collect): pure logic for the collect banner. */
export type Uncollected = { address: string; net: bigint; mine: boolean };

/** Members a settled pot still owes (net > 0), the signed-in person first, then by amount. */
export function uncollected(members: { address: string; net: string }[], me: string | undefined, settled: boolean): Uncollected[] {
  if (!settled) return [];
  const m = me?.toLowerCase();
  return members
    .map((x) => ({ address: x.address.toLowerCase(), net: BigInt(x.net), mine: x.address.toLowerCase() === m }))
    .filter((x) => x.net > 0n)
    .sort((a, b) => (a.mine !== b.mine ? (a.mine ? -1 : 1) : a.net > b.net ? -1 : a.net < b.net ? 1 : 0));
}
