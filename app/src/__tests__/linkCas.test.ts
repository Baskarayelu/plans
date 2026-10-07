/**
 * Compare-and-set updates of relayer slots (lib/link/cas.ts) against a fake slot store that
 * injects conflicts, the device list's merge under concurrent writers, the removed-marker write,
 * and the removed-browser check's decisions (lib/link/removalWatch.ts).
 */
jest.mock("../config", () => ({ config: { relayerUrl: "https://relayer.test", linkHost: "plans.0xo.in", rpId: "plans.0xo.in" } }));
jest.mock("../lib/state/kv", () => {
  const m = new Map<string, string>();
  return { kvGet: async (k: string) => m.get(k) ?? null, kvSet: async (k: string, v: string) => void m.set(k, v), kvDelete: async (k: string) => void m.delete(k) };
});
jest.mock("react-native-passkey", () => ({ Passkey: {} }));

import { backoffMs, CAS_ATTEMPTS, CONFLICT_MESSAGE, isSlotConflictError, SlotConflictError, updateSlot, type SlotIO } from "../lib/link/cas";
import { markVaultRemoved } from "../lib/link/deviceOps";
import { devicesRootFrom, devicesSlot, emptyDevices, fetchDevices, isRemovedVault, markRemoved, REMOVED_VAULT, sealDevices, updateDevices, upsertSelf, type DeviceList } from "../lib/link/devices";
import { classifyProbe, shouldProbe } from "../lib/link/removalWatch";
import { SlotError, type PutSlotOptions } from "../lib/link/slots";

const NOW = 1_800_000_000;

/** In-memory slots with the relayer's rev / ifRev rules; hooks to inject conflicts and interleavings. */
class FakeSlots implements SlotIO {
  slots = new Map<string, { data: Uint8Array; rev: number; auth?: string }>();
  puts: { id: string; ifRev?: number; ok: boolean }[] = [];
  sleeps: number[] = [];
  /** Conditional writes that will conflict regardless (a persistent race), per slot id: remaining count. */
  conflictsLeft = new Map<string, number>();
  /** Runs before a PUT is applied (another device writing in between). */
  beforePut?: (id: string) => Promise<void> | void;
  /** Without revisions (an old relayer): GET returns no rev and ifRev is ignored. */
  noRev = false;
  /** Called on each GET (to hold reads at a barrier). */
  onGet?: (id: string) => Promise<void>;
  error?: Error;

  async get(id: string) {
    await this.onGet?.(id);
    if (this.error) throw this.error;
    const s = this.slots.get(id);
    return s ? { data: s.data, ...(this.noRev ? {} : { rev: s.rev }) } : null;
  }
  async put(id: string, bytes: Uint8Array, o: PutSlotOptions) {
    await this.beforePut?.(id);
    if (this.error) throw this.error;
    const cur = this.slots.get(id);
    if (cur && cur.auth !== o.auth) throw new SlotError("taken", 409, "SLOT_TAKEN");
    const rev = cur?.rev ?? 0;
    const forced = this.conflictsLeft.get(id) ?? 0;
    if (!this.noRev && o.ifRev !== undefined && (o.ifRev !== rev || forced > 0)) {
      if (forced > 0) this.conflictsLeft.set(id, forced - 1);
      this.puts.push({ id, ifRev: o.ifRev, ok: false });
      throw new SlotError("conflict", 409, "SLOT_CONFLICT", rev);
    }
    this.slots.set(id, { data: new Uint8Array(bytes), rev: rev + 1, auth: o.auth });
    this.puts.push({ id, ifRev: o.ifRev, ok: true });
    return this.noRev ? {} : { rev: rev + 1 };
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
  }
  random() {
    return 0.5;
  }
}

const ID = "ab".repeat(32);
const AUTH = "cd".repeat(32);
const enc = (xs: string[]) => new TextEncoder().encode(JSON.stringify(xs));
const dec = (b: Uint8Array | null): string[] => (b ? (JSON.parse(new TextDecoder().decode(b)) as string[]) : []);
/** An idempotent edit: add `x` to the set (null when it's already there). */
const addItem = (x: string) => (cur: string[]) => (cur.includes(x) ? null : [...cur, x]);
const setOpts = (io: SlotIO, x: string) => ({ decode: dec, apply: addItem(x), encode: enc, auth: AUTH, io });

describe("updateSlot (compare-and-set with retries)", () => {
  it("creates with ifRev 0, then writes with the rev it read", async () => {
    const io = new FakeSlots();
    expect(await updateSlot(ID, setOpts(io, "a"))).toMatchObject({ value: ["a"], changed: true, rev: 1, tries: 1 });
    expect(await updateSlot(ID, setOpts(io, "b"))).toMatchObject({ value: ["a", "b"], rev: 2, tries: 1 });
    expect(io.puts.map((p) => p.ifRev)).toEqual([0, 1]);
  });

  it("nothing to do → no write", async () => {
    const io = new FakeSlots();
    await updateSlot(ID, setOpts(io, "a"));
    expect(await updateSlot(ID, setOpts(io, "a"))).toMatchObject({ changed: false, value: ["a"], rev: 1 });
    expect(io.puts).toHaveLength(1);
  });

  it("a conflict re-reads and re-applies the same edit on top of the other writer's change", async () => {
    const io = new FakeSlots();
    await updateSlot(ID, setOpts(io, "a"));
    let raced = false;
    io.beforePut = async () => {
      if (raced) return;
      raced = true;
      // another device adds "x" between our read and our write
      const other = new FakeSlots();
      other.slots = io.slots;
      await updateSlot(ID, setOpts(other, "x"));
    };
    const r = await updateSlot(ID, setOpts(io, "b"));
    expect(r).toMatchObject({ value: ["a", "x", "b"], tries: 2, rev: 3 });
    expect(io.puts.filter((p) => !p.ok)).toHaveLength(1);
    expect(io.sleeps).toHaveLength(1);
  });

  it("retries with a small random backoff and succeeds on the last try", async () => {
    const io = new FakeSlots();
    io.conflictsLeft.set(ID, CAS_ATTEMPTS - 1);
    const r = await updateSlot(ID, setOpts(io, "a"));
    expect(r.tries).toBe(CAS_ATTEMPTS);
    expect(io.sleeps).toHaveLength(CAS_ATTEMPTS - 1);
    for (const ms of io.sleeps) expect(ms).toBeGreaterThan(0), expect(ms).toBeLessThanOrEqual(600);
  });

  it("gives up after 6 conflicting tries with SlotConflictError and the copy; nothing written", async () => {
    const io = new FakeSlots();
    await updateSlot(ID, setOpts(io, "a"));
    io.conflictsLeft.set(ID, 99);
    const e = await updateSlot(ID, setOpts(io, "b")).catch((x) => x);
    expect(e).toBeInstanceOf(SlotConflictError);
    expect(isSlotConflictError(e)).toBe(true);
    expect(e.friendly).toBe(CONFLICT_MESSAGE);
    expect(CONFLICT_MESSAGE).toBe("Your devices changed on another device at the same moment. Nothing was changed here — try again.");
    expect(io.puts.filter((p) => !p.ok)).toHaveLength(CAS_ATTEMPTS);
    expect(dec(io.slots.get(ID)!.data)).toEqual(["a"]);
    expect(io.slots.get(ID)!.rev).toBe(1);
  });

  it("other errors (offline, taken) are thrown at once, not retried", async () => {
    const io = new FakeSlots();
    io.error = new SlotError("offline", 0, "NETWORK");
    await expect(updateSlot(ID, setOpts(io, "a"))).rejects.toMatchObject({ kind: "offline" });
    io.error = undefined;
    await updateSlot(ID, setOpts(io, "a"));
    await expect(updateSlot(ID, { ...setOpts(io, "b"), auth: "ef".repeat(32) })).rejects.toMatchObject({ kind: "taken" });
    expect(io.sleeps).toHaveLength(0);
  });

  it("a relayer without revisions: unconditional write, read back, redone when another write replaced it", async () => {
    const io = new FakeSlots();
    io.noRev = true;
    await updateSlot(ID, setOpts(io, "a"));
    // Last writer wins on an old relayer: right after our write lands, another device overwrites it.
    const realPut = io.put.bind(io);
    let n = 0;
    io.put = async (id, bytes, o) => {
      expect(o.ifRev).toBeUndefined();
      const out = await realPut(id, bytes, o);
      if (n++ === 0) io.slots.set(id, { ...io.slots.get(id)!, data: enc(["a", "x"]) }); // our "b" lost
      return out;
    };
    const r = await updateSlot(ID, setOpts(io, "b"));
    expect(r.tries).toBe(2);
    expect(dec(io.slots.get(ID)!.data)).toEqual(["a", "x", "b"]);
  });

  it("backoff grows a little with the try number and stays small", () => {
    expect(backoffMs(1, () => 0)).toBe(30);
    expect(backoffMs(1, () => 1)).toBe(150);
    expect(backoffMs(4, () => 1)).toBe(600);
    expect(backoffMs(9, () => 1)).toBe(600);
  });
});

describe("device list under concurrent writers", () => {
  const root = devicesRootFrom(new Uint8Array(32).fill(0x22));
  const slot = devicesSlot(root);
  const phone = { id: "1111111111111111", kind: "phone" as const, label: "Pixel 8", linked: false };
  const a = { id: "aaaaaaaaaaaaaaaa", kind: "browser" as const, label: "Chrome on a Mac", linked: true, vault: { id: "01".repeat(32), auth: "02".repeat(32) } };
  const c = { id: "cccccccccccccccc", kind: "browser" as const, label: "Safari on a Mac", linked: true, vault: { id: "03".repeat(32), auth: "04".repeat(32) } };

  function seeded(): FakeSlots {
    const io = new FakeSlots();
    let list: DeviceList = emptyDevices();
    list = upsertSelf(list, phone, NOW)!;
    list = upsertSelf(list, c, NOW)!;
    io.slots.set(slot.id, { data: sealDevices(root, list), rev: 1, auth: slot.auth });
    return io;
  }

  it("RACE: one device adds a browser while another removes a different one, both reading the same rev → both changes kept", async () => {
    const io = seeded();
    // Hold both reads until both have read rev 1, so both writes carry ifRev 1.
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    io.onGet = async () => {
      if (arrived >= 2) return;
      if (++arrived === 2) release();
      await gate;
    };
    const [add, remove] = await Promise.all([
      updateDevices(root, (l) => upsertSelf(l, a, NOW + 5), { io }),
      updateDevices(root, (l) => markRemoved(l, c.id, phone.id, NOW + 5), { io }),
    ]);
    expect(io.puts.filter((p) => !p.ok)).toHaveLength(1); // exactly one lost the race and retried
    expect(io.puts.filter((p) => p.ok)).toHaveLength(2);
    const final = await fetchDevices(root, io);
    expect(final.devices.find((d) => d.id === a.id)).toMatchObject({ label: "Chrome on a Mac", vault: a.vault });
    expect(final.devices.find((d) => d.id === c.id)!.removedAt).toBe(NOW + 5);
    expect(final.events.map((e) => `${e.kind}:${e.device}`)).toEqual(expect.arrayContaining([`added:${a.id}`, `removed:${c.id}`]));
    expect(io.slots.get(slot.id)!.rev).toBe(3);
    // each caller got a list with its own change in it
    expect(add.devices.some((d) => d.id === a.id)).toBe(true);
    expect(remove.devices.find((d) => d.id === c.id)!.removedAt).toBeDefined();
  });

  it("RACE: ten devices refreshing themselves at once → all ten listed", async () => {
    const io = seeded();
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    io.onGet = async () => {
      if (arrived >= 10) return;
      if (++arrived === 10) release();
      await gate;
    };
    const ids = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(16));
    await Promise.all(ids.map((id) => updateDevices(root, (l) => upsertSelf(l, { id, kind: "browser", label: `B${id[0]}`, linked: false }, NOW), { io, attempts: 12 })));
    const final = await fetchDevices(root, io);
    for (const id of ids) expect(final.devices.some((d) => d.id === id)).toBe(true);
  });

  it("persistent conflict on the list → SlotConflictError, list unchanged", async () => {
    const io = seeded();
    const before = io.slots.get(slot.id)!.data;
    io.conflictsLeft.set(slot.id, 99);
    await expect(updateDevices(root, (l) => upsertSelf(l, a, NOW), { io })).rejects.toBeInstanceOf(SlotConflictError);
    expect(io.slots.get(slot.id)!.data).toBe(before);
  });
});

describe("the removed marker in a browser's vault slot", () => {
  const vault = { id: "05".repeat(32), auth: "06".repeat(32) };
  const box = new Uint8Array([1, 2, 3, 4]);

  it("written with ifRev; already removed → nothing written; never put back", async () => {
    const io = new FakeSlots();
    io.slots.set(vault.id, { data: box, rev: 4, auth: vault.auth });
    expect(await markVaultRemoved(vault, io)).toBe(true);
    expect(isRemovedVault(io.slots.get(vault.id)!.data)).toBe(true);
    expect(io.puts.at(-1)!.ifRev).toBe(4);
    // a second removal (another device): nothing to write, still removed
    expect(await markVaultRemoved(vault, io)).toBe(true);
    expect(io.puts).toHaveLength(1);
  });

  it("a marker write that keeps conflicting never lands: SlotConflictError, the vault as it was", async () => {
    const io = new FakeSlots();
    io.slots.set(vault.id, { data: box, rev: 1, auth: vault.auth });
    io.conflictsLeft.set(vault.id, 99);
    await expect(markVaultRemoved(vault, io)).rejects.toBeInstanceOf(SlotConflictError);
    expect(Array.from(io.slots.get(vault.id)!.data)).toEqual([1, 2, 3, 4]);
  });

  it("a conflicting write to the vault (the browser saving it meanwhile) is re-read and the marker still lands", async () => {
    const io = new FakeSlots();
    io.slots.set(vault.id, { data: box, rev: 1, auth: vault.auth });
    let once = false;
    io.beforePut = () => {
      if (once) return;
      once = true;
      io.slots.set(vault.id, { data: new Uint8Array([9, 9]), rev: 2, auth: vault.auth });
    };
    expect(await markVaultRemoved(vault, io)).toBe(true);
    expect(io.slots.get(vault.id)!.rev).toBe(3);
    expect(isRemovedVault(io.slots.get(vault.id)!.data)).toBe(true);
    expect(REMOVED_VAULT[0]).toBe(0);
  });
});

describe("removed-browser check: decisions", () => {
  it("only the removed marker means removed; errors and a missing vault never lock", () => {
    expect(classifyProbe({ ok: true, box: REMOVED_VAULT })).toBe("removed");
    expect(classifyProbe({ ok: true, box: new Uint8Array([1, ...new Uint8Array(60)]) })).toBe("present");
    expect(classifyProbe({ ok: true, box: null })).toBe("unknown");
    expect(classifyProbe({ ok: false, error: new SlotError("offline", 0, "NETWORK") })).toBe("unknown");
    expect(classifyProbe({ ok: false, error: new SlotError("offline", 503, "") })).toBe("unknown");
    expect(classifyProbe({ ok: false, error: new SlotError("rate-limited", 429, "") })).toBe("unknown");
    expect(classifyProbe({ ok: false, error: new Error("boom") })).toBe("unknown");
    // a near-miss of the marker isn't the marker
    const near = new Uint8Array(REMOVED_VAULT);
    near[near.length - 1] ^= 1;
    expect(classifyProbe({ ok: true, box: near })).toBe("present");
  });

  it("checks only linked, unlocked browsers, and trusts a passed check for maxAgeMs", () => {
    const base = { linked: true, unlocked: true, now: 100_000, lastOkAt: 0, maxAgeMs: 5_000 };
    expect(shouldProbe(base)).toBe(true);
    expect(shouldProbe({ ...base, linked: false })).toBe(false);
    expect(shouldProbe({ ...base, unlocked: false })).toBe(false);
    expect(shouldProbe({ ...base, lastOkAt: 96_000 })).toBe(false);
    expect(shouldProbe({ ...base, lastOkAt: 95_000 })).toBe(true);
    expect(shouldProbe({ ...base, lastOkAt: 99_999, maxAgeMs: 0 })).toBe(true);
  });
});
