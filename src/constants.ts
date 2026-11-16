// Keep in step with the client's src/config.js by hand. One player per base: the hub has 6 bases
// (client BASE.positions), so a room holds 6 players. The deploy workflow sends this as `roomSize`
// (Boxity's docs: maxClients = room size 2-100, send roomSize in the deploy, never seatCap).
export const ROOM_MAX_CLIENTS = 6;

// Longest accepted strings.
export const NAME_MAX = 64;
// Profile picture URL (Bloxity `pfp`), relayed so other players can draw it.
export const PFP_MAX_LEN = 512;
// Presence (presence.ts): the Bloxity avatar JSON relayed for the others to draw, and the pose
// bounds (|x|, |y|, |z| up to `xy` m; speed in m/s).
export const AVATAR_MAX_LEN = 3000;
export const POSE_BOUNDS = { xy: 5000, speed: 2000 };

// Colyseus drops the whole connection for a WebSocket message above this (default 4 KB).
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// How long a dropped connection (WiFi blip, backgrounded tab) may reconnect with the same session.
export const RECONNECT_SECONDS = 20;

// Upper bounds for saved values, so a forged payload cannot store a bogus number. Generous
// ceilings, not game rules: the dearest tool costs ~2.2e12 and the best treasure earns 5e7 $/s
// (client config.js TOOLS / TREASURES), multiplied by rebirths.
export const CURRENCY_MAX = 1e33; // cash, a collector's stored cash, total earned
export const REBIRTHS_MAX = 1e9;
export const COUNT_MAX = 1e15; // lifetime counters (items stolen, heists, busts)
export const TIME_MAX = 1e15; // an epoch-ms timestamp (spawn timers, daily clock)

// Counts and lists (client BASE.slotsPerSide * 2 = 12 slots, UPGRADES.carry.max = 8, 14 TOOLS,
// FLOOR_COUNT = 50, 9 RARITIES, ~45 TREASURES), with slack.
export const SLOTS_MAX = 64; // base slots, unlocked or not
export const CARRY_MAX = 64; // items held at once
export const TOOLS_MAX = 64; // owned tool indexes are 0..TOOLS_MAX-1
export const FLOOR_MAX = 1000;
export const DISCOVERED_MAX = 256; // treasure ids in the Index
export const RARITY_KEYS_MAX = 32; // timed-spawn rarities
// Daily Gifts (client DAILY.rewards): days in one cycle.
export const DAILY_DAYS = 7;

// Leaderboards (leaderboard.ts): the stats ranked, the saved doc field each one reads, rows per
// board and how often the lists are re-read and re-sent. Stats live under `stats` in the save.
export const LEADERBOARD_FIELDS = {
  rebirths: "rebirths",
  earned: "stats.earned", // total cash earned
  maxFloor: "stats.maxFloor", // highest tower floor reached
  stolen: "stats.stolen", // treasures stolen
} as const;
export const LEADERBOARD_STATS = Object.keys(LEADERBOARD_FIELDS) as (keyof typeof LEADERBOARD_FIELDS)[];
export type LeaderboardStat = keyof typeof LEADERBOARD_FIELDS;
export const LEADERBOARD_SIZE = 10;
export const LEADERBOARD_EVERY_MS = 60 * 1000;

// Bloxity (bloxity.ts). The game's slug on bloxity.io (client config.js GAME_SLUG).
export const GAME_SLUG = "risky-heist";
// The hosted leaderboards, declared to Boxity with every report (client config.js BLOXITY.boards
// declares the same ones; ids are permanent: lowercase a-z 0-9 _ -, max 32). One per ranked stat.
export const LEADERBOARD_BOARDS: Record<LeaderboardStat, { id: string; label: string; order: "desc"; mode: "best"; format: "number" | "compact"; reset: "none" }> = {
  rebirths: { id: "rebirths", label: "Rebirths", order: "desc", mode: "best", format: "compact", reset: "none" },
  earned: { id: "earned", label: "Cash earned", order: "desc", mode: "best", format: "compact", reset: "none" },
  maxFloor: { id: "maxfloor", label: "Highest floor", order: "desc", mode: "best", format: "number", reset: "none" },
  stolen: { id: "stolen", label: "Treasures stolen", order: "desc", mode: "best", format: "compact", reset: "none" },
};
// Game stats shown on Boxity profiles (max 50 definitions; key a-z 0-9 _, label <= 40 chars) and the
// ceiling per type: a value above it is rejected by Boxity, so values are clamped to it.
export const STAT_CEILINGS = { number: 1e9, seconds: 31_536_000_000, currency: 1e12, percent: 100 } as const;
export const STAT_DEFINITIONS: { key: string; label: string; type: keyof typeof STAT_CEILINGS; field: string }[] = [
  { key: "rebirths", label: "Rebirths", type: "number", field: "rebirths" },
  { key: "cash_earned", label: "Cash earned", type: "currency", field: "earned" },
  { key: "max_floor", label: "Highest floor", type: "number", field: "maxFloor" },
  { key: "items_stolen", label: "Treasures stolen", type: "number", field: "stolen" },
  { key: "heists", label: "Heists", type: "number", field: "heists" },
  { key: "busts", label: "Times busted", type: "number", field: "busts" },
];

// Ids from the client's catalogs (treasures, rarities): lowercase slugs, so nothing odd is stored.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// The client's per-browser fallback id for players who are not signed in to Bloxity.
// Guests are never persisted.
export const GUEST_ID_PREFIX = "guest-";
