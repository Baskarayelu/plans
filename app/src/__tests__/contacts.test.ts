/**
 * Contacts must survive a lock/unlock cycle: a call while locked must not cache an empty list
 * that later overwrites the saved contacts.
 */
const mockKeys: { current: object | null } = { current: null };
const mockDisk: Record<string, unknown> = {};

jest.mock("../lib/identity/session", () => ({
  currentKeys: () => mockKeys.current,
  onSignOut: () => undefined,
}));
jest.mock("../lib/state/cache", () => ({
  cacheRead: (name: string) => (mockKeys.current ? (mockDisk[name] ?? null) : null),
  cacheWrite: (name: string, v: unknown) => {
    if (!mockKeys.current) return false;
    mockDisk[name] = JSON.parse(JSON.stringify(v));
    return true;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const g = require("../lib/domain/groups") as typeof import("../lib/domain/groups");

const A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const B = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

beforeEach(() => {
  for (const k of Object.keys(mockDisk)) delete mockDisk[k];
  mockKeys.current = null;
  g.resetContactsMemory();
});

describe("contacts cache", () => {
  it("a locked first read does not wipe saved contacts after unlock", () => {
    mockDisk.contacts = { [A.toLowerCase()]: { name: "Sam", updatedAt: 1 } };
    expect(g.contacts()).toEqual({}); // locked
    mockKeys.current = {}; // unlock
    expect(g.contactFor(A)?.name).toBe("Sam");
    g.rememberContact(B, { name: "Asha", city: "Bengaluru" });
    expect(Object.keys(mockDisk.contacts as object).sort()).toEqual([A.toLowerCase(), B.toLowerCase()].sort());
  });

  it("names learnt while locked are merged into saved contacts on unlock", () => {
    mockDisk.contacts = { [A.toLowerCase()]: { name: "Sam", updatedAt: 1 } };
    g.rememberContact(B, { name: "Asha" }); // locked: kept in memory only
    expect(g.contactFor(B)?.name).toBe("Asha");
    expect(Object.keys(mockDisk.contacts as object)).toEqual([A.toLowerCase()]);
    mockKeys.current = {};
    expect(g.contactFor(A)?.name).toBe("Sam");
    expect(g.contactFor(B)?.name).toBe("Asha");
    expect(Object.keys(mockDisk.contacts as object)).toHaveLength(2);
  });

  it("a new unlock (new key set) reloads from disk", () => {
    mockKeys.current = {};
    g.rememberContact(A, { name: "Sam" });
    mockKeys.current = null; // lock
    expect(g.contactFor(A)).toBeUndefined();
    mockKeys.current = {}; // unlock again with fresh keys
    expect(g.contactFor(A)?.name).toBe("Sam");
  });
});
