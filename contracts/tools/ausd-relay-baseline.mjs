// Baseline for GAS.md: gas for one relayed AUSD transferWithAuthorization to a fresh recipient,
// estimated live on Monad mainnet (read-only: eth_estimateGas with a balance state override; nothing is sent).
//   node tools/ausd-relay-baseline.mjs
import { encodeAbiParameters, encodeFunctionData, keccak256, pad, parseSignature, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.MONAD_RPC ?? "https://rpc.monad.xyz";
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
// AUSD balances: mapping at this base slot, value stored as (balance << 8 | frozenFlag) — see test/fork.
const BAL_BASE = "0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700";

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

const chainId = Number(await rpc("eth_chainId", []));
const block = Number(await rpc("eth_blockNumber", []));
const payer = privateKeyToAccount(generatePrivateKey());
const relayer = privateKeyToAccount(generatePrivateKey()).address;
const to = privateKeyToAccount(generatePrivateKey()).address;
const now = BigInt(Math.floor(Date.now() / 1000));
const msg = { from: payer.address, to, value: 1_000_000n, validAfter: 0n, validBefore: now + 3600n, nonce: keccak256(toHex(`baseline-${Date.now()}`)) };
const sig = parseSignature(
  await payer.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId, verifyingContract: AUSD },
    primaryType: "TransferWithAuthorization",
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    message: msg,
  }),
);
const data = encodeFunctionData({
  abi: [{ type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable", outputs: [],
    inputs: ["address", "address", "uint256", "uint256", "uint256", "bytes32", "uint8", "bytes32", "bytes32"].map((type) => ({ type })) }],
  functionName: "transferWithAuthorization",
  args: [msg.from, msg.to, msg.value, msg.validAfter, msg.validBefore, msg.nonce, Number(sig.v), sig.r, sig.s],
});
const balSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [payer.address, BAL_BASE]));
const override = { [AUSD]: { stateDiff: { [balSlot]: pad(toHex(5_000_000n << 8n), { size: 32 }) } } };

const gas = Number(await rpc("eth_estimateGas", [{ from: relayer, to: AUSD, data }, "latest", override]));
const gasPrice = Number(await rpc("eth_gasPrice", []));
const mon = (gas * gasPrice) / 1e18;
let usd = null;
try {
  const p = await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd")).json();
  usd = p.monad.usd;
} catch {}

console.log("AUSD transferWithAuthorization, relayed");
console.log(`  chain      ${chainId}, block ${block.toLocaleString("en-US")}`);
console.log(`  gas        ${gas.toLocaleString("en-US")}`);
console.log(`  gas price  ${gasPrice / 1e9} gwei`);
console.log(`  cost       ${mon.toFixed(5)} MON`);
if (usd) console.log(`  in USD     $${(mon * usd).toFixed(5)} at MON $${usd.toFixed(4)}`);
