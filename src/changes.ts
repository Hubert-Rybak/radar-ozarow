import type { RecordKind } from "./types";

/** public/data/changes.json — records that first appeared on a given import day (scripts/build_changes.py). */
export interface PermitChange { id: string; title: string; kind: RecordKind; locality: string }
export interface InvestmentChange { id: string; title: string; recordType: string; sourceId: string }
export interface ChangeDay { date: string; permits: PermitChange[]; investments: InvestmentChange[] }
export interface ChangeLog { schemaVersion: 1; generatedAt: string | null; since: string; days: ChangeDay[] }

const day = /^\d{4}-\d{2}-\d{2}$/;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function entries<T>(value: unknown, fields: string[]): T[] {
  if (!Array.isArray(value) || !value.every(e => object(e) && fields.every(f => typeof e[f] === "string") && !!e.id))
    throw new Error("Nieprawidłowy wpis w liście zmian.");
  return value as T[];
}

export function parseChanges(value: unknown): ChangeLog {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.since !== "string" || !day.test(value.since) || !Array.isArray(value.days))
    throw new Error("Nieprawidłowy format listy zmian.");
  const days = value.days.map(d => {
    if (!object(d) || typeof d.date !== "string" || !day.test(d.date)) throw new Error("Nieprawidłowa data w liście zmian.");
    return {
      date: d.date,
      permits: entries<PermitChange>(d.permits, ["id", "title", "kind", "locality"]),
      investments: entries<InvestmentChange>(d.investments, ["id", "title", "recordType", "sourceId"]),
    };
  });
  days.sort((a, b) => b.date.localeCompare(a.date));
  return { schemaVersion: 1, generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null, since: value.since, days };
}

export async function loadChanges(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ChangeLog> {
  const response = await fetcher(`${import.meta.env.BASE_URL}data/changes.json`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseChanges(await response.json());
}

/** "sobota, 31 października 2026", or "31 października 2026" without the weekday. */
export function formatDay(value: string, weekday = true): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value
    : new Intl.DateTimeFormat("pl-PL", { ...(weekday ? { weekday: "long" } : {}), day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Polish plural: 1 nowa budowa, 2 nowe budowy, 5 nowych budów. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100, units = n % 10;
  return `${n} ${n === 1 ? one : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many}`;
}
