import { useSyncExternalStore } from "react";

/** Minimal observable store (no external state library). */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((prev: T) => T)) {
      state = typeof next === "function" ? (next as (p: T) => T)(state) : next;
      for (const l of listeners) l();
    },
    patch(p: Partial<T>) {
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Store<T> = ReturnType<typeof createStore<T>>;

export function useStore<T, S = T>(store: Store<T>, select: (s: T) => S = (s) => s as unknown as S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
