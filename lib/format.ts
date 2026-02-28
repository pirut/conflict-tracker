import { formatDistanceToNowStrict } from "date-fns";

export function formatLocal(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function formatUtc(ts: number): string {
  return new Date(ts).toUTCString();
}

export function formatAgo(ts: number): string {
  return formatDistanceToNowStrict(ts, { addSuffix: true });
}

export function shortNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}
