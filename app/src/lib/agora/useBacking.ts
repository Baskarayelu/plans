import { useQuery } from "@tanstack/react-query";
import { fetchMonadSupply } from "./backing";

/** Agora's live supply figures for Monad; `data` stays undefined on any failure (the UI hides it). */
export function useMonadSupply() {
  return useQuery({ queryKey: ["agoraMetrics"], queryFn: () => fetchMonadSupply(), staleTime: 10 * 60_000, gcTime: 60 * 60_000, retry: 1 });
}
