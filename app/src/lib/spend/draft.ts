/**
 * The spend being written (21 / 25), shared with the split editor (23). One draft at a time;
 * `key` says which form it belongs to so opening a different payee starts fresh. Also used by
 * the dispute screen (31) for "Change the split" (key "resplit:<pot>:<disputeId>").
 */
import { createStore, useStore } from "../state/observable";
import type { SplitMode } from "./logic";

export type SpendPhoto = { uri: string; base64: string; width?: number; height?: number };

export type SpendDraft = {
  key: string;
  pot: string;
  amountText: string;
  inLocal: boolean;
  /** dollar units computed from amountText (kept here so the split editor can read it) */
  units: bigint;
  category: number;
  splitMode: SplitMode;
  /** chosen members (lowercase) for pick/custom; ignored for everyone */
  chosen: string[];
  weights: Record<string, number>;
  note: string;
  photo?: SpendPhoto;
  /** label for the split editor title, e.g. the payee or note */
  label?: string;
  /** set by the split editor when Done is pressed */
  splitDoneAt?: number;
};

export const EMPTY_DRAFT: SpendDraft = {
  key: "",
  pot: "",
  amountText: "",
  inLocal: false,
  units: 0n,
  category: 7,
  splitMode: "everyone",
  chosen: [],
  weights: {},
  note: "",
};

export const spendDraft = createStore<SpendDraft>(EMPTY_DRAFT);

export function startDraft(key: string, pot: string, init: Partial<SpendDraft> = {}): void {
  if (spendDraft.get().key === key) return;
  spendDraft.set({ ...EMPTY_DRAFT, key, pot: pot.toLowerCase(), ...init });
}

export function patchDraft(p: Partial<SpendDraft>): void {
  spendDraft.patch(p);
}

export function clearDraft(): void {
  spendDraft.set(EMPTY_DRAFT);
}

export function useDraft(): SpendDraft {
  return useStore(spendDraft);
}
