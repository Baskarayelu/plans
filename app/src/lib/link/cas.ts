/**
 * Read-modify-write of a relayer slot without lost updates (relayer/README.md "Keyed slots",
 * docs/crypto.md §9.8a):
 *
 *   read (data, rev) → decode → apply the change → encode → PUT {ifRev: rev}
 *   409 SLOT_CONFLICT → small random wait, read again, apply the SAME change again; up to 6 tries
 *
 * so `apply` must be an idempotent edit of whatever is there now ("add this entry by id", "mark
 * this id removed", "write the removed marker"), never a whole value computed from an older read.
 * It returns null when there is nothing to do. When every try conflicts, SlotConflictError is
 * thrown and nothing was written by this call.
 *
 * A relayer from before revisions returns no rev: the write is then unconditional and is read back
 * to check the change is there (the old, weaker behaviour), so a mixed rollout keeps working.
 */
import { SlotError, getSlotRev, putSlot, type PutSlotOptions } from "./slots";

export const CAS_ATTEMPTS = 6;

/** What the person is told when every try conflicted. Shown as is (copy-checked). */
export const CONFLICT_MESSAGE = "Your devices changed on another device at the same moment. Nothing was changed here — try again.";

export class SlotConflictError extends Error {
  constructor(
    public slotId: string,
    public attempts: number,
  ) {
    super(CONFLICT_MESSAGE);
    this.name = "SlotConflictError";
  }
  get friendly(): string {
    return CONFLICT_MESSAGE;
  }
}

export const isSlotConflictError = (e: unknown): e is SlotConflictError => e instanceof SlotConflictError;

/** The slot I/O, swappable in tests (a fake store that injects conflicts). */
export type SlotIO = {
  get(id: string): Promise<{ data: Uint8Array; rev?: number } | null>;
  put(id: string, bytes: Uint8Array, opts: PutSlotOptions): Promise<{ rev?: number }>;
  sleep(ms: number): Promise<void>;
  random(): number;
};

export const relayerSlotIO: SlotIO = {
  get: getSlotRev,
  put: putSlot,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
};

/** Wait before try `attempt` (1-based retries): 30–150 ms, growing a little each time, random so two devices drift apart. */
export function backoffMs(attempt: number, random: () => number): number {
  return Math.round((30 + random() * 120) * Math.min(attempt, 4));
}

export type UpdateSlotOptions<T> = {
  /** null = the slot doesn't exist. */
  decode(bytes: Uint8Array | null): T;
  apply(current: T): T | null;
  encode(next: T): Uint8Array;
  auth?: string;
  attempts?: number;
  io?: SlotIO;
};

export type UpdateSlotResult<T> = {
  /** The value now stored (after this change, or as found when there was nothing to do). */
  value: T;
  changed: boolean;
  /** The revision `value` was read or written at (undefined on a relayer without revisions). */
  rev?: number;
  /** Tries used (1 = no conflict). */
  tries: number;
};

export async function updateSlot<T>(id: string, o: UpdateSlotOptions<T>): Promise<UpdateSlotResult<T>> {
  const io = o.io ?? relayerSlotIO;
  const attempts = o.attempts ?? CAS_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await io.sleep(backoffMs(i, io.random));
    const cur = await io.get(id);
    const value = o.decode(cur?.data ?? null);
    const next = o.apply(value);
    if (!next) return { value, changed: false, rev: cur?.rev, tries: i + 1 };
    // rev missing on an existing slot = a relayer without revisions → unconditional write, checked below.
    const ifRev = cur ? cur.rev : 0;
    try {
      const w = await io.put(id, o.encode(next), { auth: o.auth, ...(ifRev !== undefined ? { ifRev } : {}) });
      if (ifRev !== undefined) return { value: next, changed: true, rev: w.rev, tries: i + 1 };
      // Old relayer: read back; if another write replaced ours, the change is missing → redo it.
      const back = await io.get(id);
      const after = o.decode(back?.data ?? null);
      if (!o.apply(after)) return { value: after, changed: true, rev: back?.rev, tries: i + 1 };
    } catch (e) {
      if (!(e instanceof SlotError && e.kind === "conflict")) throw e;
    }
  }
  throw new SlotConflictError(id, attempts);
}
