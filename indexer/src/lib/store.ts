// Per-handler unit of work: loads entities once, hands out mutable copies, writes them back in
// flush(). Every handler builds one Store, mutates objects freely, and calls flush() at the end,
// so helpers can share the same in-memory Pot / GlobalStats / Member objects without lost updates.
import type {
  Account,
  Ack,
  Activity,
  AllowlistEntry,
  CategorySpend,
  Claim,
  Contribution,
  Corridor,
  CorridorFlow,
  DailyStats,
  Debt,
  Dispute,
  DisputeVote,
  EvmOnEventContext,
  Freeze,
  FxReferenceConfig,
  FxRound,
  GlobalStats,
  KeyWrap,
  Member,
  MemberBalance,
  Payout,
  Pot,
  PotCorridor,
  PotDaily,
  Pull,
  RuleChange,
  RuleChangeVote,
  RulesVersion,
  Send,
  PotSettlement,
  SettlementEdge,
  Spend,
  SpendShare,
  Vote,
} from "envio";
import type { Meta } from "./util.js";

export type EntityMap = {
  Account: Account;
  Ack: Ack;
  Activity: Activity;
  AllowlistEntry: AllowlistEntry;
  CategorySpend: CategorySpend;
  Claim: Claim;
  Contribution: Contribution;
  Corridor: Corridor;
  CorridorFlow: CorridorFlow;
  DailyStats: DailyStats;
  Debt: Debt;
  Dispute: Dispute;
  DisputeVote: DisputeVote;
  Freeze: Freeze;
  FxReferenceConfig: FxReferenceConfig;
  FxRound: FxRound;
  GlobalStats: GlobalStats;
  KeyWrap: KeyWrap;
  Member: Member;
  MemberBalance: MemberBalance;
  Payout: Payout;
  Pot: Pot;
  PotCorridor: PotCorridor;
  PotDaily: PotDaily;
  Pull: Pull;
  RuleChange: RuleChange;
  RuleChangeVote: RuleChangeVote;
  RulesVersion: RulesVersion;
  Send: Send;
  PotSettlement: PotSettlement;
  SettlementEdge: SettlementEdge;
  Spend: Spend;
  SpendShare: SpendShare;
  Vote: Vote;
};

export type Name = keyof EntityMap;

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
export type E<N extends Name> = Mutable<EntityMap[N]>;

export type Ctx = EvmOnEventContext;

type Ops = {
  get: (id: string) => Promise<unknown>;
  set: (e: unknown) => void;
  deleteUnsafe: (id: string) => void;
};

export class Store {
  private cache = new Map<string, unknown>();
  private dirty = new Map<string, { name: Name; obj: unknown }>();
  private deleted = new Map<string, { name: Name; id: string }>();

  constructor(
    readonly ctx: Ctx,
    readonly m: Meta,
  ) {}

  private ops(name: Name): Ops {
    return (this.ctx as unknown as Record<string, Ops>)[name]!;
  }

  async get<N extends Name>(name: N, id: string): Promise<E<N> | undefined> {
    const key = `${name}:${id}`;
    if (this.deleted.has(key)) return undefined;
    if (this.cache.has(key)) return this.cache.get(key) as E<N>;
    const found = (await this.ops(name).get(id)) as EntityMap[N] | undefined;
    if (!found) return undefined;
    const copy = { ...found } as E<N>;
    // re-check: another awaited load may have populated the cache meanwhile
    if (this.cache.has(key)) return this.cache.get(key) as E<N>;
    this.cache.set(key, copy);
    return copy;
  }

  /** Loads an entity that the caller is going to modify (marked dirty). */
  async load<N extends Name>(name: N, id: string): Promise<E<N> | undefined> {
    const e = await this.get(name, id);
    if (e) this.put(name, e);
    return e;
  }

  /** Loads the entity or creates it with `make()`; the result is marked dirty either way. */
  async getOr<N extends Name>(name: N, id: string, make: () => E<N>): Promise<{ e: E<N>; created: boolean }> {
    const found = await this.load(name, id);
    if (found) return { e: found, created: false };
    const e = make();
    this.put(name, e);
    return { e, created: true };
  }

  /** Marks an entity (new or loaded) to be written on flush. */
  put<N extends Name>(name: N, e: E<N>): E<N> {
    const id = (e as { id: string }).id;
    const key = `${name}:${id}`;
    this.deleted.delete(key);
    this.cache.set(key, e);
    this.dirty.set(key, { name, obj: e });
    return e;
  }

  del(name: Name, id: string): void {
    const key = `${name}:${id}`;
    this.cache.delete(key);
    this.dirty.delete(key);
    this.deleted.set(key, { name, id });
  }

  flush(): void {
    for (const { name, id } of this.deleted.values()) this.ops(name).deleteUnsafe(id);
    for (const { name, obj } of this.dirty.values()) this.ops(name).set(obj);
    this.deleted.clear();
    this.dirty.clear();
  }
}
