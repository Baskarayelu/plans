import { randomBytes, toHex } from "../crypto/bytes";

/**
 * Unordered-nonce allocator that keeps gas low (contracts/GAS.md).
 *
 * The pots store used nonces as a bitmap: nonces sharing their upper 248 bits share one storage
 * word. A random 256-bit nonce costs a fresh word every time (~17,000 gas of state growth plus a
 * page write on Monad). Instead each device picks a random 248-bit prefix per account and counts
 * up in the low byte, so it pays for a new word once per 256 actions.
 *
 * - The prefix is random per device and account, so two phones with the same passkey never collide.
 * - After 256 nonces, or when the relayer reports a used nonce (collision, restored storage), a new
 *   random prefix is drawn.
 * - State is persisted through `NonceStore` (SecureStore in the app; memory in tests) so a restart
 *   continues the counter instead of reusing it.
 */
export type NonceState = { prefix: string /* 31-byte hex, no 0x */; next: number };

export type NonceStore = {
  load(account: string): Promise<NonceState | null>;
  save(account: string, s: NonceState): Promise<void>;
};

function freshPrefix(): string {
  return toHex(randomBytes(31)).slice(2);
}

export class NonceAllocator {
  private states = new Map<string, NonceState>();
  private loaded = new Map<string, Promise<void>>();

  constructor(private store: NonceStore) {}

  private async ensure(account: string): Promise<NonceState> {
    const key = account.toLowerCase();
    if (!this.loaded.has(key)) {
      this.loaded.set(
        key,
        this.store.load(key).then((s) => {
          if (s && /^[0-9a-f]{62}$/.test(s.prefix) && s.next >= 0 && s.next <= 256) this.states.set(key, s);
          else this.states.set(key, { prefix: freshPrefix(), next: 0 });
        }),
      );
    }
    await this.loaded.get(key);
    return this.states.get(key)!;
  }

  /** Next nonce for `account`. Synchronous bump after load, so parallel callers never share one. */
  async next(account: string): Promise<bigint> {
    const key = account.toLowerCase();
    let s = await this.ensure(key);
    if (s.next > 255) {
      s = { prefix: freshPrefix(), next: 0 };
      this.states.set(key, s);
    }
    const n = (BigInt(`0x${s.prefix}`) << 8n) | BigInt(s.next);
    s.next += 1;
    void this.store.save(key, { ...s }).catch(() => undefined);
    return n;
  }

  /** Call when a nonce turned out to be used already: move to a new random prefix. */
  async rotate(account: string): Promise<void> {
    const key = account.toLowerCase();
    await this.ensure(key);
    const s = { prefix: freshPrefix(), next: 0 };
    this.states.set(key, s);
    await this.store.save(key, s).catch(() => undefined);
  }

  /** A fully random 256-bit nonce (fallback). */
  static random(): bigint {
    return BigInt(toHex(randomBytes(32)));
  }
}

export class MemoryNonceStore implements NonceStore {
  data = new Map<string, NonceState>();
  async load(a: string) {
    return this.data.get(a) ?? null;
  }
  async save(a: string, s: NonceState) {
    this.data.set(a, s);
  }
}
