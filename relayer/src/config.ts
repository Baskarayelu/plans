import { inspect } from "node:util";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

/** Holds a private key so that it can never be logged or serialised by accident. */
export class Secret<T extends string = Hex> {
  #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  reveal(): T {
    return this.#value;
  }
  toJSON() {
    return "[redacted]";
  }
  toString() {
    return "[redacted]";
  }
  [inspect.custom]() {
    return "[redacted]";
  }
}

export const KNOWN_CHAINS = {
  143: {
    name: "Monad",
    rpc: ["https://rpc.monad.xyz", "https://rpc1.monad.xyz", "https://rpc2.monad.xyz", "https://rpc3.monad.xyz"],
    ws: "wss://rpc.monad.xyz",
    ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    faucet: undefined,
    testnet: false,
  },
  10143: {
    name: "Monad Testnet",
    rpc: ["https://testnet-rpc.monad.xyz"],
    ws: undefined,
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
    testnet: true,
  },
} as const;

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));
const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return def;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `not a number: ${v}` });
        return z.NEVER;
      }
      return n;
    });
const big = (def: bigint) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return def;
      try {
        return BigInt(v);
      } catch {
        ctx.addIssue({ code: "custom", message: `not an integer: ${v}` });
        return z.NEVER;
      }
    });
const optAddress = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    if (!isAddress(v, { strict: false })) {
      ctx.addIssue({ code: "custom", message: `not an address: ${v}` });
      return z.NEVER;
    }
    return getAddress(v);
  });
const pkRe = /^0x[0-9a-fA-F]{64}$/;
const optKey = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const k = (v.startsWith("0x") ? v : `0x${v}`).trim();
    if (!pkRe.test(k)) {
      ctx.addIssue({ code: "custom", message: "invalid private key format (value hidden)" });
      return z.NEVER;
    }
    return new Secret(k as Hex);
  });
const list = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: int(8080),
  HOST: z.string().optional().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
  CHAIN_ID: int(10143),
  RPC_URL: list,
  WS_URL: z.string().optional(),
  FACTORY_ADDRESS: optAddress,
  KEY_REGISTRY_ADDRESS: optAddress,
  CLAIM_ESCROW_ADDRESS: optAddress,
  PLANS_SEND_ADDRESS: optAddress,
  AUSD_ADDRESS: optAddress,
  RELAYER_KEYS: list,
  DATA_DIR: z.string().optional().default("./data"),

  START_BLOCK: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : BigInt(v))),
  LOG_CHUNK_BLOCKS: int(100),
  POLL_INTERVAL_MS: int(2000),
  LISTENER_ENABLED: bool(true),

  GAS_MARGIN_BPS: int(1000),
  GAS_MARGIN_FIXED: int(10_000),
  GAS_CAPS: z.string().optional(),
  PRIORITY_FEE_GWEI: int(2),
  MAX_FEE_GWEI: int(1000),
  LANE_MIN_BALANCE_WEI: big(500_000_000_000_000_000n), // 0.5 MON

  BODY_LIMIT_BYTES: int(64 * 1024),
  CORS_ORIGINS: z.string().optional().default("https://plans.0xo.in"),
  TRUST_PROXY: bool(true),
  RATE_LIMIT_IP_PER_MIN: int(120),
  RATE_LIMIT_ADDRESS_PER_MIN: int(30),
  CREATE_POT_PER_IP_PER_DAY: int(30),

  FX_URL: z.string().optional().default("https://api.frankfurter.app/latest"),
  FX_CACHE_MS: int(10 * 60 * 1000),
  FX_SIGNER_KEY: optKey,

  FAUCET_ENABLED: z.string().optional(),
  FAUCET_ADDRESS: optAddress,
  FAUCET_AMOUNT: big(25_000_000n),
  FAUCET_PER_ADDRESS_PER_DAY: int(1),
  FAUCET_PER_IP_PER_DAY: int(3),

  PUSH_ENABLED: bool(true),
  EXPO_PUSH_URL: z.string().optional().default("https://exp.host/--/api/v2/push/send"),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  DEMO_ENABLED: bool(false),
  DEMO_KEY_BEN: optKey,
  DEMO_KEY_ASHA: optKey,
  DEMO_KEY_MAYA: optKey,
  DEMO_APPROVE_CAP: big(1_000_000n),
  DEMO_VOTE_DELAY_MIN_MS: int(3000),
  DEMO_VOTE_DELAY_MAX_MS: int(8000),
  DEMO_STEP_DELAY_MS: int(1500),
  DEMO_DEPOSIT: big(100_000n),
  DEMO_MAX_OUTLAY: big(300_000n),
  DEMO_PLAN_MINUTES: int(15),
  DEMO_PER_JUDGE_PER_DAY: int(3),
  DEMO_PER_IP_PER_DAY: int(10),
  DEMO_TICK_MS: int(1000),

  LONGSTOP_ENABLED: bool(true),
  LONGSTOP_INTERVAL_MS: int(60 * 60 * 1000),
  LONGSTOP_GRACE_DAYS: int(30),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  const known = KNOWN_CHAINS[e.CHAIN_ID as keyof typeof KNOWN_CHAINS] as
    | (typeof KNOWN_CHAINS)[keyof typeof KNOWN_CHAINS]
    | undefined;
  const rpcUrls = e.RPC_URL.length ? e.RPC_URL : known ? [...known.rpc] : [];
  if (!rpcUrls.length) throw new Error("Invalid configuration: RPC_URL is required for unknown CHAIN_ID");

  const relayerKeys = e.RELAYER_KEYS.map((k, i) => {
    const kk = k.startsWith("0x") ? k : `0x${k}`;
    if (!pkRe.test(kk)) throw new Error(`Invalid configuration: RELAYER_KEYS[${i}] is not a 32-byte hex key (value hidden)`);
    return new Secret(kk as Hex);
  });

  let gasCaps: Record<string, number> = {};
  if (e.GAS_CAPS) {
    try {
      gasCaps = z.record(z.string(), z.number().int().positive()).parse(JSON.parse(e.GAS_CAPS));
    } catch {
      throw new Error("Invalid configuration: GAS_CAPS must be a JSON object of action -> gas limit");
    }
  }

  const isMainnet = e.CHAIN_ID === 143;
  const faucetAddress = e.FAUCET_ADDRESS ?? (known?.faucet ? getAddress(known.faucet) : undefined);
  // The faucet is never available on mainnet, whatever the env says.
  const faucetFlag = e.FAUCET_ENABLED?.trim();
  const faucetEnabled = !isMainnet && (!faucetFlag ? e.CHAIN_ID === 10143 : ["1", "true", "yes", "on"].includes(faucetFlag.toLowerCase()));

  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    chainId: e.CHAIN_ID,
    chainName: known?.name ?? `Chain ${e.CHAIN_ID}`,
    isMainnet,
    rpcUrls,
    wsUrl: e.WS_URL === "none" ? undefined : e.WS_URL || known?.ws,
    contracts: {
      factory: e.FACTORY_ADDRESS,
      keyRegistry: e.KEY_REGISTRY_ADDRESS,
      claimEscrow: e.CLAIM_ESCROW_ADDRESS,
      plansSend: e.PLANS_SEND_ADDRESS,
      ausd: e.AUSD_ADDRESS ?? (known ? getAddress(known.ausd) : undefined),
    } as { factory?: Address; keyRegistry?: Address; claimEscrow?: Address; plansSend?: Address; ausd?: Address },
    relayerKeys,
    dataDir: e.DATA_DIR,
    listener: {
      enabled: e.LISTENER_ENABLED,
      startBlock: e.START_BLOCK,
      chunk: Math.min(Math.max(1, e.LOG_CHUNK_BLOCKS), 100),
      pollMs: e.POLL_INTERVAL_MS,
    },
    gas: {
      marginBps: e.GAS_MARGIN_BPS,
      marginFixed: e.GAS_MARGIN_FIXED,
      caps: gasCaps,
      priorityFeeWei: BigInt(e.PRIORITY_FEE_GWEI) * 1_000_000_000n,
      maxFeeWei: BigInt(e.MAX_FEE_GWEI) * 1_000_000_000n,
      laneMinBalanceWei: e.LANE_MIN_BALANCE_WEI,
    },
    http: {
      bodyLimit: e.BODY_LIMIT_BYTES,
      corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
      trustProxy: e.TRUST_PROXY,
      ipPerMin: e.RATE_LIMIT_IP_PER_MIN,
      addressPerMin: e.RATE_LIMIT_ADDRESS_PER_MIN,
      createPotPerIpPerDay: e.CREATE_POT_PER_IP_PER_DAY,
    },
    fx: { url: e.FX_URL, cacheMs: e.FX_CACHE_MS, signerKey: e.FX_SIGNER_KEY },
    faucet: {
      enabled: faucetEnabled,
      address: faucetAddress,
      amount: e.FAUCET_AMOUNT,
      perAddressPerDay: e.FAUCET_PER_ADDRESS_PER_DAY,
      perIpPerDay: e.FAUCET_PER_IP_PER_DAY,
    },
    push: { enabled: e.PUSH_ENABLED, url: e.EXPO_PUSH_URL, accessToken: e.EXPO_ACCESS_TOKEN },
    demo: {
      enabled: e.DEMO_ENABLED,
      keys: { ben: e.DEMO_KEY_BEN, asha: e.DEMO_KEY_ASHA, maya: e.DEMO_KEY_MAYA },
      approveCap: e.DEMO_APPROVE_CAP,
      voteDelayMinMs: e.DEMO_VOTE_DELAY_MIN_MS,
      voteDelayMaxMs: Math.max(e.DEMO_VOTE_DELAY_MIN_MS, e.DEMO_VOTE_DELAY_MAX_MS),
      stepDelayMs: e.DEMO_STEP_DELAY_MS,
      deposit: e.DEMO_DEPOSIT,
      maxOutlay: e.DEMO_MAX_OUTLAY,
      planMinutes: e.DEMO_PLAN_MINUTES,
      perJudgePerDay: e.DEMO_PER_JUDGE_PER_DAY,
      perIpPerDay: e.DEMO_PER_IP_PER_DAY,
      tickMs: e.DEMO_TICK_MS,
    },
    longStop: { enabled: e.LONGSTOP_ENABLED, intervalMs: e.LONGSTOP_INTERVAL_MS, graceDays: e.LONGSTOP_GRACE_DAYS },
  };
}
