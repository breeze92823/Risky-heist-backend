import {
  CURRENCY_MAX, REBIRTHS_MAX, COUNT_MAX, TIME_MAX, SLOTS_MAX, CARRY_MAX, TOOLS_MAX, FLOOR_MAX, DISCOVERED_MAX,
  RARITY_KEYS_MAX, DAILY_DAYS, ID_PATTERN,
} from "./constants.js";
import type { PlayerDoc, SavedDaily, SavedSlot, SavedStats } from "./db.js";

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function clampNum(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}
export function clampInt(v: number, max: number, min = 0): number {
  return Math.min(max, Math.max(min, Math.floor(v)));
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

// Treasure ids in order, repeats kept (the same treasure can be held or placed twice), bounded.
function idList(raw: unknown, max: number): string[] {
  return Array.isArray(raw) ? raw.filter(isId).slice(0, max) : [];
}

// A list of distinct ids (the Index).
function idSet(raw: unknown, max: number): string[] {
  return [...new Set(idList(raw, Infinity))].slice(0, max);
}

// Owned tool indexes: whole numbers in range, no duplicates.
function toolIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < TOOLS_MAX);
  return [...new Set(ok)].sort((a, b) => a - b);
}

// The base's slots, position by position: a treasure id or null, and the cash it has stored.
function sanitizeSlots(raw: unknown): SavedSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, SLOTS_MAX).map((s) => {
    const slot = isObject(s) ? s : {};
    return { id: isId(slot.id) ? slot.id : null, stored: finite(slot.stored) ? clampNum(slot.stored, CURRENCY_MAX) : 0 };
  });
}

function sanitizeStats(raw: unknown): SavedStats {
  const s = isObject(raw) ? raw : {};
  const count = (v: unknown) => (finite(v) ? clampInt(v, COUNT_MAX) : 0);
  return {
    stolen: count(s.stolen),
    heists: count(s.heists),
    earned: finite(s.earned) ? clampNum(s.earned, CURRENCY_MAX) : 0,
    busts: count(s.busts),
    bestId: isId(s.bestId) ? s.bestId : null,
    maxFloor: finite(s.maxFloor) ? clampInt(s.maxFloor, FLOOR_MAX, 1) : 1,
  };
}

// Daily Gifts: day 1..DAILY_DAYS, one claimed flag per day, the next unlock time.
function sanitizeDaily(raw: unknown): SavedDaily {
  const d = isObject(raw) ? raw : {};
  const claimed = Array.isArray(d.claimed) ? d.claimed : [];
  return {
    day: finite(d.day) ? clampInt(d.day, DAILY_DAYS, 1) : 1,
    claimed: Array.from({ length: DAILY_DAYS }, (_, i) => claimed[i] === true),
    nextAt: finite(d.nextAt) ? clampNum(d.nextAt, TIME_MAX) : 0,
  };
}

// { rarity id: value } maps (timed-spawn clocks, pending flags): slug keys, bounded count.
function sanitizeMap<T>(raw: unknown, ok: (v: unknown) => v is T, fix: (v: T) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= RARITY_KEYS_MAX) break;
    if (isId(k) && ok(v)) out[k] = fix(v);
  }
  return out;
}

// The game is client-authoritative -- no server-side gameplay validation. What IS enforced:
// shape and bounds, so a malformed payload can never corrupt this player's own Mongo document.
// A forged number can only ever affect the sender's own save. Idempotent: the same function
// cleans the doc read back from Mongo.
export function sanitizeProgress(raw: unknown): Partial<PlayerDoc> | null {
  if (!isObject(raw)) return null;
  const out: Partial<PlayerDoc> = {};

  if (finite(raw.money)) out.money = clampNum(raw.money, CURRENCY_MAX);
  if (finite(raw.carryCap)) out.carryCap = clampInt(raw.carryCap, CARRY_MAX, 1);
  if (finite(raw.unlocked)) out.unlocked = clampInt(raw.unlocked, SLOTS_MAX, 1);
  if (finite(raw.tool)) out.tool = clampInt(raw.tool, TOOLS_MAX - 1);
  if (raw.owned !== undefined) out.owned = toolIndexes(raw.owned);
  if (raw.slots !== undefined) out.slots = sanitizeSlots(raw.slots);
  if (raw.carried !== undefined) out.carried = idList(raw.carried, CARRY_MAX);
  if (raw.discovered !== undefined) out.discovered = idSet(raw.discovered, DISCOVERED_MAX);
  if (finite(raw.rebirths)) out.rebirths = clampInt(raw.rebirths, REBIRTHS_MAX);
  if (raw.daily !== undefined) out.daily = sanitizeDaily(raw.daily);
  if (raw.stats !== undefined) out.stats = sanitizeStats(raw.stats);
  if (raw.spawns !== undefined) out.spawns = sanitizeMap(raw.spawns, finite, (v) => clampNum(v, TIME_MAX));
  if (raw.pending !== undefined) out.pending = sanitizeMap(raw.pending, (v): v is boolean => typeof v === "boolean", (v) => v);
  if (finite(raw.lastSeen)) out.lastSeen = clampInt(raw.lastSeen, Date.now() + 10 * 60 * 1000);
  return out;
}
