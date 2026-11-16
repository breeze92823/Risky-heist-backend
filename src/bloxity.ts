import { matchMaker } from "colyseus";

import { GAME_SLUG, LEADERBOARD_BOARDS, LEADERBOARD_STATS, STAT_DEFINITIONS, STAT_CEILINGS, type LeaderboardStat } from "./constants.js";

// The Bloxity (Legion) platform from the server's side (https://docs.bloxity.io): who a player really
// is (token verification), rewarded-ad verification, and the reporters Boxity hosting asks for (live
// rooms, game stats, leaderboards). Everything here is best-effort and never throws into the game:
// with no network / no hosting variables it quietly does nothing, and every URL comes from the
// BLOXITY_* variables the platform injects (prod only when they are missing) -- never hardcoded.

export interface BloxityEnv {
  apiUrl: string; // BLOXITY_API_URL
  gameId: string; // BLOXITY_GAME_ID, injected on hosted games ("" when not hosted)
  reportToken: string; // BLOXITY_REPORT_TOKEN, injected on hosted games
  matchmakerReportUrl: string; // MATCHMAKER_REPORT_URL, for the live-room reporter
  pod: string; // POD_NAME or HOSTNAME
}

export function bloxityEnv(): BloxityEnv {
  const e = process.env;
  return {
    apiUrl: (e.BLOXITY_API_URL || "https://api.bloxity.io").replace(/\/+$/, ""),
    gameId: e.BLOXITY_GAME_ID || "",
    reportToken: e.BLOXITY_REPORT_TOKEN || "",
    matchmakerReportUrl: (e.MATCHMAKER_REPORT_URL || "").replace(/\/+$/, ""),
    pod: e.POD_NAME || e.HOSTNAME || "",
  };
}

// Test seam: every request goes through this.
let http: typeof fetch = (...args) => fetch(...args);
export function __setFetchForTest(fake: typeof fetch | null): void {
  http = fake ?? ((...args) => fetch(...args));
}

const TIMEOUT_MS = 4000;
async function postJson(url: string, body: unknown, token?: string): Promise<Response> {
  return http(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// --- Identity -------------------------------------------------------------------------------
export interface VerifiedUser {
  _id: string; // the Bloxity account id: the ONLY id the server may use for an account
  username?: string;
  displayName?: string;
  pfp?: string;
}

// Asks Bloxity who owns a player's token (POST /v1/auth/game-token/verify). A refused token (401)
// means a guest: null. Never falls back to anything the client sent about itself.
export async function verifyToken(token: unknown): Promise<VerifiedUser | null> {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  try {
    const res = await postJson(`${bloxityEnv().apiUrl}/v1/auth/game-token/verify`, { gameSlug: GAME_SLUG }, token);
    if (!res.ok) return null;
    const data = (await res.json()) as { valid?: boolean; user?: VerifiedUser };
    return data?.valid !== false && typeof data?.user?._id === "string" && data.user._id ? data.user : null;
  } catch (err) {
    console.warn("[bloxity] token verification failed", err);
    return null;
  }
}

// Test seam for identity: a replacement for verifyToken.
let verifier: (token: unknown) => Promise<VerifiedUser | null> = verifyToken;
export const verifyPlayer = (token: unknown) => verifier(token);
export function __setVerifierForTest(fake: typeof verifier | null): void {
  verifier = fake ?? verifyToken;
}

// A rewarded ad's token (POST /v1/ads/reward/verify): true only when Bloxity says it is valid
// (single use, this game, within 5 minutes). No token / no answer = no reward.
export async function verifyAdReward(rewardToken: unknown): Promise<boolean> {
  if (typeof rewardToken !== "string" || !rewardToken || rewardToken.length > 4096) return false;
  try {
    const res = await postJson(`${bloxityEnv().apiUrl}/v1/ads/reward/verify`, { gameSlug: GAME_SLUG, rewardToken });
    if (!res.ok) return false;
    return ((await res.json()) as { valid?: boolean })?.valid === true;
  } catch (err) {
    console.warn("[bloxity] ad reward verification failed", err);
    return false;
  }
}

// --- Reporters ------------------------------------------------------------------------------
// What the reporters read: the signed-in players of every live room, from the server's own copy of
// their progress (WorldRoom registers a source per room).
export interface ReportedPlayer {
  userId: string; // Bloxity account id
  rebirths: number;
  earned: number;
  maxFloor: number;
  stolen: number;
  heists: number;
  busts: number;
}
type Source = () => ReportedPlayer[];
const sources = new Set<Source>();
export function addPlayerSource(source: Source): () => void {
  sources.add(source);
  return () => sources.delete(source);
}
const livePlayers = (): ReportedPlayer[] => [...sources].flatMap((s) => s());

const legionId = (userId: string) => `legion_${userId.replace(/#m.*$/, "")}`;
const finiteNonNeg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

// Boxity hosting only: no-ops without BLOXITY_GAME_ID + BLOXITY_REPORT_TOKEN.
const hosted = () => {
  const env = bloxityEnv();
  return env.gameId && env.reportToken ? env : null;
};

// Game stats (POST /v1/games/{gameId}/stats): current values per signed-in player, 200 per request.
export async function reportStats(): Promise<void> {
  const env = hosted();
  if (!env) return;
  const players = livePlayers();
  if (!players.length) return;
  const rows = players.map((p) => ({
    userId: legionId(p.userId),
    values: Object.fromEntries(
      STAT_DEFINITIONS.map((d) => [d.key, Math.min(STAT_CEILINGS[d.type], finiteNonNeg(p[d.field as keyof ReportedPlayer]))]),
    ),
  }));
  const definitions = STAT_DEFINITIONS.map((d, i) => ({ key: d.key, label: d.label, type: d.type, sortOrder: i }));
  for (let i = 0; i < rows.length; i += 200) {
    try {
      const res = await postJson(`${env.apiUrl}/v1/games/${env.gameId}/stats`, { definitions, players: rows.slice(i, i + 200) }, env.reportToken);
      if (!res.ok) console.warn("[bloxity] stats report refused", res.status);
      else {
        const out = (await res.json().catch((): null => null)) as { dropped?: Record<string, number> } | null;
        if (out?.dropped && Object.values(out.dropped).some((n) => n > 0)) console.warn("[bloxity] stats dropped", out.dropped);
      }
    } catch (err) {
      console.warn("[bloxity] stats report failed", err);
    }
  }
}

// Hosted leaderboards (POST /v1/leaderboards/hosted/{gameId}/report): scores come from the server's
// copy of the progress, never a client packet. Only scores that changed since the last report are sent.
const lastScores = new Map<string, number>();
export async function reportLeaderboards(): Promise<void> {
  const env = hosted();
  if (!env) return;
  const scores: { board: string; userId: string; score: number }[] = [];
  for (const p of livePlayers()) {
    for (const stat of LEADERBOARD_STATS) {
      const score = Math.floor(finiteNonNeg(p[LEADERBOARD_VALUE[stat]]));
      const key = `${p.userId}|${stat}`;
      if (score <= 0 || lastScores.get(key) === score) continue;
      scores.push({ board: LEADERBOARD_BOARDS[stat].id, userId: legionId(p.userId), score });
      lastScores.set(key, score);
    }
  }
  if (!scores.length) return;
  const boards = LEADERBOARD_STATS.map((s) => LEADERBOARD_BOARDS[s]);
  for (let i = 0; i < scores.length; i += 200) {
    try {
      const res = await postJson(`${env.apiUrl}/v1/leaderboards/hosted/${env.gameId}/report`, { boards, scores: scores.slice(i, i + 200) }, env.reportToken);
      if (!res.ok) {
        console.warn("[bloxity] leaderboard report refused", res.status);
        lastScores.clear(); // resend everything next time
      }
    } catch (err) {
      console.warn("[bloxity] leaderboard report failed", err);
      lastScores.clear();
    }
  }
}
const LEADERBOARD_VALUE: Record<LeaderboardStat, keyof ReportedPlayer> = { rebirths: "rebirths", earned: "earned", maxFloor: "maxFloor", stolen: "stolen" };

// Live rooms (POST {MATCHMAKER_REPORT_URL}/{gameId}/rooms every 2 s): how Boxity lists open rooms and
// sizes pods. Best-effort; errors are swallowed.
export async function reportRooms(): Promise<void> {
  const env = hosted();
  if (!env || !env.matchmakerReportUrl) return;
  try {
    const rooms = await matchMaker.query({});
    const body = {
      podName: env.pod,
      players: rooms.reduce((n, r) => n + r.clients, 0),
      rooms: rooms.map((r) => ({
        colyseusRoomId: r.roomId,
        name: r.name,
        clients: r.clients,
        maxClients: r.maxClients,
        locked: !!r.locked,
        private: !!r.private,
        started: false,
        metadata: r.metadata ?? {},
      })),
    };
    await postJson(`${env.matchmakerReportUrl}/${env.gameId}/rooms`, body, env.reportToken);
  } catch {
    // Best-effort.
  }
}

export const STATS_EVERY_MS = 60_000;
export const LEADERBOARD_REPORT_EVERY_MS = 30_000;
export const ROOMS_EVERY_MS = 2_000;

// Starts the reporters (after listen()); returns a stop function. Each one is a no-op unless the
// hosting variables are set, so a local `npm start` does nothing here.
export function installReporters(): () => void {
  const timers = [
    setInterval(() => void reportRooms(), ROOMS_EVERY_MS),
    setInterval(() => void reportStats(), STATS_EVERY_MS),
    setInterval(() => void reportLeaderboards(), LEADERBOARD_REPORT_EVERY_MS),
  ];
  timers.forEach((t) => t.unref());
  // A last report when Legion drains the pod (SIGTERM), without taking over the shutdown itself.
  const flush = (): void => void Promise.all([reportStats(), reportLeaderboards()]);
  process.once("SIGTERM", flush);
  return () => {
    timers.forEach(clearInterval);
    process.off("SIGTERM", flush);
  };
}
