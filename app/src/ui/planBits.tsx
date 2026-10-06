import React from "react";
import { formatUsd } from "../lib/domain/currency";
import { Chip } from "./kit";
import { useLocal } from "./money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateRange(start: number, end: number): string {
  const s = new Date(start * 1000);
  const e = new Date(end * 1000);
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]}`;
  return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
}

export function ago(sec: number): string {
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)} min`;
  if (d < 86400) return `${Math.floor(d / 3600)} h`;
  const dt = new Date(sec * 1000);
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
}


export function PositionChip({ net, debt, settled }: { net: bigint; debt?: bigint; settled?: boolean }) {
  const local = useLocal();
  if (settled && debt && debt > 0n) return <Chip sm tone="neg" label={`You owe ${local.fmt(debt) ?? formatUsd(debt)}`} />;
  if (net > 0n) return <Chip sm tone="pos" label={`You're owed ${local.fmt(net) ?? formatUsd(net)}`} />;
  if (net < 0n) return <Chip sm tone="neg" label={`You owe ${local.fmt(-net) ?? formatUsd(-net)}`} />;
  return <Chip sm label="All square" />;
}

