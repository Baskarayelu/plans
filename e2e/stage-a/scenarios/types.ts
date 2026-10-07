import type { Server } from "node:http";
import type { PrivateKeyAccount } from "viem/accounts";
import type { RelayerProc } from "../lib/env";
import type { Env, Runner } from "../lib/harness";
import type { Actors } from "./actors";

export interface T {
  R: Runner;
  env: Env;
  A: Actors;
  main: RelayerProc;
  strict: RelayerProc;
  fx: { url: string; server: Server; hits: number };
  /** FxReference owner and CRE simulation transmitter (this run's throwaway keys). */
  fxKeys: { owner: PrivateKeyAccount; transmitter: PrivateKeyAccount };
}
