import { AVATAR_MAX_LEN, ID_PATTERN, POSE_BOUNDS, SLOTS_MAX } from "./constants.js";
import type { PlayerState } from "./rooms/schema/WorldState.js";

// Presence: what the other clients need to draw a player in the world. Relayed through the
// roster as sent, only bounded here -- like the rest of the game it is client-authoritative and
// purely cosmetic.

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// `pose` { x, y, z, yaw, speed, grounded, carry, riding, swing }: the player's feet position (m), heading
// (rad), speed (m/s), whether they stand on the floor, the best treasure id they carry ("" = none),
// whether they ride the zipline and whether they are swinging at a door.
export function applyPose(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  const b = POSE_BOUNDS;
  if (finite(m.x)) p.x = clamp(m.x, -b.xy, b.xy);
  if (finite(m.y)) p.y = clamp(m.y, -b.xy, b.xy);
  if (finite(m.z)) p.z = clamp(m.z, -b.xy, b.xy);
  if (finite(m.yaw)) p.yaw = Math.atan2(Math.sin(m.yaw), Math.cos(m.yaw));
  if (finite(m.speed)) p.speed = clamp(m.speed, 0, b.speed);
  if (typeof m.grounded === "boolean") p.grounded = m.grounded;
  if (typeof m.riding === "boolean") p.riding = m.riding;
  if (typeof m.swing === "boolean") p.swing = m.swing;
  if (m.carry === "" || (typeof m.carry === "string" && ID_PATTERN.test(m.carry))) p.carry = m.carry;
}

// `emote` { id }: the portal emote the sender is playing ("" = stopped). Catalogue ids are opaque
// slugs; anything else is ignored. Ownership is Boxity's business, not ours.
export function applyEmote(p: PlayerState, msg: unknown): void {
  const id = (msg as { id?: unknown })?.id;
  if (id === "" || (typeof id === "string" && ID_PATTERN.test(id))) p.emote = id;
}

// `setBase` { unlocked, items }: what this player's base shows the others -- the slots unlocked and
// the treasure id on each slot ("" = empty). Cosmetic and bounded like the rest of presence; it
// does not touch the saved progress (guests have a base too).
export function applyBase(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  if (finite(m.unlocked)) p.baseUnlocked = Math.floor(clamp(m.unlocked, 0, SLOTS_MAX));
  if (Array.isArray(m.items)) {
    const ids = m.items.slice(0, SLOTS_MAX).map((id) => (typeof id === "string" && ID_PATTERN.test(id) ? id : ""));
    p.baseItems = ids.join(",");
  }
}

// The lowest hub plot no player in the room owns, -1 when all `max` are taken.
export function freeBase(players: Iterable<PlayerState>, max: number): number {
  const taken = new Set<number>();
  for (const p of players) taken.add(p.base);
  for (let i = 0; i < max; i++) if (!taken.has(i)) return i;
  return -1;
}

// `setAvatar` { avatar }: the Bloxity look as an opaque JSON string ("" = default), length-capped.
export function applyAvatar(p: PlayerState, msg: unknown): void {
  const a = (msg as { avatar?: unknown })?.avatar;
  if (typeof a === "string" && a.length <= AVATAR_MAX_LEN) p.avatar = a;
}
