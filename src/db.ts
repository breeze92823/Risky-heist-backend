import { MongoClient, type Collection } from "mongodb";

import { LEADERBOARD_FIELDS, LEADERBOARD_STATS } from "./constants.js";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

// The persisted client state (what `saveProgress` carries, see sanitize.ts; the client's
// heist/game.js `state`). The client keeps nothing in the browser: this document is the
// player's only save.
export interface PlayerDoc {
  _id: string; // Bloxity user id -- see WorldRoom.ts (guests are never saved)
  username?: string; // display name as of the last save
  money?: number; // cash on hand
  carryCap?: number; // items that can be carried at once
  unlocked?: number; // base slots unlocked
  tool?: number; // index of the equipped tool (client TOOLS)
  owned?: number[]; // owned tool indexes
  slots?: SavedSlot[]; // the base's slots, in order (null id = empty)
  carried?: string[]; // treasure ids in the player's hands
  discovered?: string[]; // treasure ids ever found (the Index)
  rebirths?: number;
  daily?: SavedDaily; // Daily Gifts
  stats?: SavedStats;
  spawns?: Record<string, number>; // rarity -> epoch ms its next timed spawn arrives
  pending?: Record<string, boolean>; // rarity -> a timed spawn waits for the next heist
  lastSeen?: number; // epoch ms of the last activity (collectors fill while away)
  version: number;
  updatedAt: Date;
}

// One base slot: the treasure placed on it and the cash its collector holds.
export interface SavedSlot {
  id: string | null;
  stored: number;
}

// Daily Gifts: the day unlocked this cycle (1..DAILY_DAYS), which days were claimed, and when the
// next day unlocks (epoch ms, the client's clock).
export interface SavedDaily {
  day: number;
  claimed: boolean[];
  nextAt: number;
}

export interface SavedStats {
  stolen: number;
  heists: number;
  earned: number;
  busts: number;
  bestId: string | null;
  maxFloor: number;
}

let client: MongoClient | null = null;
let players: Collection<PlayerDoc> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set -- player progress will not persist");
    return;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    // No dbName passed to .db() -- the injected URI already points at this game+channel's database.
    players = client.db().collection<PlayerDoc>("players");
    console.log("[db] connected to MongoDB");
    // The leaderboards sort and count by these (leaderboard.ts).
    for (const stat of LEADERBOARD_STATS) {
      const field = LEADERBOARD_FIELDS[stat];
      players.createIndex({ [field]: -1 }).catch((err) => console.warn(`[db] index on ${field} failed`, err));
    }
  } catch (err) {
    console.warn("[db] connect failed -- player progress will not persist:", err);
    client = null;
    players = null;
  }
}

// Null whenever Mongo is unset/unreachable -- every caller must treat that as "skip persistence".
export function getPlayers(): Collection<PlayerDoc> | null {
  return players;
}

// Test-only seam: exercise the save/load logic against an in-memory fake collection.
export function __setPlayersForTest(fake: Collection<PlayerDoc> | null): void {
  players = fake;
}
