import { domainSeparator, parseAbi, type Address, type PublicClient } from "viem";
import { ausdAbi } from "./abi.js";

const extraAbi = parseAbi([
  "function name() view returns (string)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

/**
 * Find AUSD's EIP-712 domain name ("Agora Dollar" on Monad per docs/protocol.md). Tries EIP-5267,
 * then matches DOMAIN_SEPARATOR() against likely names, so mocks with another name also work.
 */
export async function resolveAusdDomain(client: PublicClient, ausd: Address, chainId: number): Promise<{ name: string; version: string }> {
  try {
    const d = (await client.readContract({ address: ausd, abi: extraAbi, functionName: "eip712Domain" })) as readonly unknown[];
    if (typeof d[1] === "string" && d[1]) return { name: d[1] as string, version: String(d[2] || "1") };
  } catch {
    /* not EIP-5267 */
  }
  try {
    const onchain = (await client.readContract({ address: ausd, abi: ausdAbi, functionName: "DOMAIN_SEPARATOR" })) as string;
    let tokenName = "";
    try {
      tokenName = (await client.readContract({ address: ausd, abi: extraAbi, functionName: "name" })) as string;
    } catch {
      /* ignore */
    }
    for (const name of ["Agora Dollar", tokenName, "AUSD", "Mock AUSD", "MockAUSD"].filter(Boolean)) {
      for (const version of ["1", "2"]) {
        const ds = domainSeparator({ domain: { name, version, chainId, verifyingContract: ausd } });
        if (ds.toLowerCase() === onchain.toLowerCase()) return { name, version };
      }
    }
  } catch {
    /* fall through */
  }
  return { name: "Agora Dollar", version: "1" };
}
