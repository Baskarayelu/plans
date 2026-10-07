import type { Server } from "node:http";
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
}
