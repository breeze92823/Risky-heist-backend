import { Room, Client, CloseCode } from "colyseus";
import { WorldState, PlayerState } from "./schema/WorldState.js";
import { LEADERBOARD_EVERY_MS, NAME_MAX, PFP_MAX_LEN, RECONNECT_SECONDS, ROOM_MAX_CLIENTS } from "../constants.js";
import { getPlayers, type PlayerDoc } from "../db.js";
import { sanitizeProgress } from "../sanitize.js";
import { addPlayerSource, verifyAdReward, verifyPlayer, type ReportedPlayer, type VerifiedUser } from "../bloxity.js";
import { applyAvatar, applyBase, applyEmote, applyPose, freeBase } from "../presence.js";
import { ranksOf, topBoards } from "../leaderboard.js";

function sanitizeName(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, NAME_MAX) : "";
}

function sanitizePfp(raw: unknown): string {
  return typeof raw === "string" && raw.length <= PFP_MAX_LEN && /^https?:\/\//i.test(raw) ? raw : "";
}

/**
 * Room every client joins via `client.joinOrCreate("world", { token, username, pfp })`. `token` is
 * the player's Bloxity token (`Legion.SDK.auth.getToken()`): the server verifies it with Bloxity
 * (onAuth, bloxity.ts) and uses only the account id Bloxity returns -- an id sent by the client is
 * never trusted, and a player without a valid token is a guest. Loads and saves each signed-in
 * player's progress (MongoDB, see db.ts). The game is client-authoritative: no gameplay rules live
 * here, saves are only bounded (sanitize.ts). Each room holds one player per hub base
 * (maxClients); a full room spills into a fresh one automatically.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  state = new WorldState();
  maxClients = ROOM_MAX_CLIENTS;

  // sessionId -> user id (Bloxity id). Deliberately NOT part of WorldState: it only gates this
  // room's own Mongo reads/writes. Guests have no entry.
  userIds = new Map<string, string>();

  // sessionIds that already got a progress/noProgress answer for their current identity.
  private identified = new Set<string>();
  // sessionIds whose current identity's save has been read: only these may write. A save sent
  // before the load answered would overwrite the stored progress with a fresh player's defaults.
  private loaded = new Set<string>();
  // sessionId -> the server's copy of the signed-in player's progress (what the Boxity stats and
  // leaderboard reporters read, bloxity.ts); set by the load, kept current by each save.
  private progress = new Map<string, Partial<PlayerDoc>>();
  // sessionId -> counter of the newest `identify` token check, so an older answer can't win.
  private identifying = new Map<string, number>();
  private removeSource: (() => void) | null = null;

  messages = {
    // Debounced push of the client's whole progress. Upserts, so a first save creates the document.
    saveProgress: async (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const patch = sanitizeProgress(msg);
      if (!p || !patch || !this.loaded.has(client.sessionId)) return;

      const userId = this.userIds.get(client.sessionId);
      if (!userId) return;
      this.progress.set(client.sessionId, { ...this.progress.get(client.sessionId), ...patch });
      const players = getPlayers();
      if (!players) return; // Mongo unset/unreachable -- degrade silently
      try {
        await players.updateOne(
          { _id: userId },
          {
            // Display name comes from this connection's own PlayerState, not `msg`.
            $set: { ...patch, username: p.username || "Player", updatedAt: new Date() },
            $setOnInsert: { version: 1 },
          },
          { upsert: true },
        );
      } catch (err) {
        console.warn("[WorldRoom] saveProgress failed", err);
      }
    },
    // Presence (presence.ts): the sender's pose ~10x/s and its Bloxity look, relayed through the
    // roster so everyone can draw them in the world.
    pose: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyPose(p, msg);
    },
    // What the sender's base shows (unlocked slots, treasure per slot), so the others see it on their plot.
    setBase: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyBase(p, msg);
    },
    // The portal emote the sender plays (or "" when it stops), shown on their character for the others.
    emote: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyEmote(p, msg);
    },
    setAvatar: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyAvatar(p, msg);
    },
    // Re-states identity after a login/logout that happens AFTER join (a guest who signs in
    // mid-session): `token` is the player's current Bloxity token ("" after signing out). The server
    // verifies it with Bloxity and answers with progress/noProgress for the verified account.
    // A message without `token` only refreshes the display name / picture.
    identify: async (client: Client, msg: { username?: string; token?: unknown; pfp?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof msg?.username === "string") p.username = sanitizeName(msg.username);
      if (typeof msg?.pfp === "string") p.pfp = sanitizePfp(msg.pfp);
      if (typeof msg?.token !== "string") return;
      const turn = (this.identifying.get(client.sessionId) ?? 0) + 1;
      this.identifying.set(client.sessionId, turn);
      const user = await verifyPlayer(msg.token);
      // Gone, or a newer identify superseded this one while Bloxity answered.
      if (this.state.players.get(client.sessionId) !== p || this.identifying.get(client.sessionId) !== turn) return;
      if (user) p.username = sanitizeName(user.displayName || user.username) || p.username;
      this.setUserId(client, p, user?._id ?? "");
    },
    // A rewarded ad finished (`Legion.SDK.ads.showRewarded`): the client sends its reward token and
    // only grants the reward when Bloxity confirms it here (single use, this game, 5 minutes).
    adReward: async (client: Client, msg: { token?: unknown; placement?: unknown }) => {
      const ok = await verifyAdReward(msg?.token);
      const placement = typeof msg?.placement === "string" ? msg.placement.slice(0, 32) : "";
      try {
        client.send("adRewardResult", { ok, placement });
      } catch {
        // Gone meanwhile.
      }
    },
  };

  // Verifies the Bloxity token sent in the join options (bloxity.ts): `client.auth.user` is the
  // verified account, or null for a guest. Never rejects -- a guest may play, just never saved.
  async onAuth(_client: Client, options?: { token?: unknown }) {
    return { user: await verifyPlayer(options?.token) };
  }

  // Leaderboards (leaderboard.ts): everyone gets the top lists + their own ranks every
  // LEADERBOARD_EVERY_MS, and once right after their save loads.
  onCreate() {
    this.clock.setInterval(() => {
      for (const c of this.clients) void this.sendLeaderboard(c);
    }, LEADERBOARD_EVERY_MS);
    // The Boxity stats / leaderboard reporters read this room's signed-in players (bloxity.ts).
    this.removeSource = addPlayerSource(() => this.reportedPlayers());
  }

  onDispose() {
    this.removeSource?.();
  }

  private reportedPlayers(): ReportedPlayer[] {
    const out: ReportedPlayer[] = [];
    for (const [sid, userId] of this.userIds) {
      const doc = this.progress.get(sid);
      if (!doc || !this.state.players.has(sid)) continue;
      const s = doc.stats;
      out.push({ userId, rebirths: doc.rebirths ?? 0, earned: s?.earned ?? 0, maxFloor: s?.maxFloor ?? 0, stolen: s?.stolen ?? 0, heists: s?.heists ?? 0, busts: s?.busts ?? 0 });
    }
    return out;
  }

  // `leaderboard` { boards: { rebirths|earned|maxFloor|stolen: [{ name, value }] }, ranks: { stat: n | null } }.
  private async sendLeaderboard(client: Client) {
    const userId = this.userIds.get(client.sessionId) ?? "";
    const [boards, ranks] = await Promise.all([topBoards(), ranksOf(userId)]);
    if (!this.state.players.has(client.sessionId)) return;
    try {
      client.send("leaderboard", { boards, ranks });
    } catch {
      // Gone meanwhile.
    }
  }

  onJoin(client: Client, options?: { username?: string; pfp?: string; pose?: unknown; avatar?: string }) {
    const user: VerifiedUser | null = client.auth?.user ?? null;
    const p = new PlayerState();
    // A verified player's name is Bloxity's own; a guest's is whatever it calls itself (display only).
    p.username = sanitizeName(user ? user.displayName || user.username : options?.username) || sanitizeName(options?.username);
    p.pfp = sanitizePfp(options?.pfp);
    // Presence from the join options, so the others draw the newcomer right away.
    applyPose(p, options?.pose);
    applyAvatar(p, options);
    // Every player owns one hub plot while in the room (maxClients = the number of plots).
    p.base = freeBase(this.state.players.values(), ROOM_MAX_CLIENTS);
    this.state.players.set(client.sessionId, p);
    this.setUserId(client, p, user?._id ?? "");
  }

  // A deliberate `room.leave()` closes with CONSENTED -- drop the player at once. Anything
  // else (WiFi blip, backgrounded tab) gets RECONNECT_SECONDS to reconnect with the same session.
  async onLeave(client: Client, code?: number) {
    if (code === CloseCode.CONSENTED) {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
    }
  }

  // Server-clock "last seen" for a player who has really gone. Call before forgetSession.
  private async stampLastSeen(sessionId: string) {
    const userId = this.userIds.get(sessionId);
    const players = getPlayers();
    if (!userId || !players) return;
    try {
      await players.updateOne({ _id: userId }, { $set: { lastSeen: Date.now() } });
    } catch (err) {
      console.warn("[WorldRoom] stampLastSeen failed", err);
    }
  }

  // Drops a session's per-connection bookkeeping.
  private forgetSession(sessionId: string) {
    this.state.players.delete(sessionId);
    this.userIds.delete(sessionId);
    this.identified.delete(sessionId);
    this.loaded.delete(sessionId);
    this.progress.delete(sessionId);
    this.identifying.delete(sessionId);
  }

  // `userId` is the account id BLOXITY returned for a verified token ("" = a guest: nothing is loaded
  // or saved for them). Never pass an id the client sent. Called from both onJoin and `identify`;
  // answers with progress / noProgress / serverError.
  private setUserId(client: Client, p: PlayerState, userId: string) {
    userId = userId.slice(0, 128);
    const prev = this.userIds.get(client.sessionId) || "";
    // No change (e.g. a username-only identify) -- but the very first call must still answer.
    if (userId === prev && this.identified.has(client.sessionId)) return;
    this.identified.add(client.sessionId);
    this.loaded.delete(client.sessionId); // no writes until the new identity's save is read
    this.progress.delete(client.sessionId); // the old account's numbers are not this one's
    p.signedIn = !!userId;
    p.userId = userId; // the verified account id ("" for a guest), public so chat bubbles find their character

    if (userId) {
      // Evict any OTHER live session already claiming this account, so one account never has
      // two racing Mongo writers (a crashed tab lingers up to RECONNECT_SECONDS via
      // allowReconnection in onLeave).
      for (const [sid, uid] of this.userIds) {
        if (sid === client.sessionId || uid !== userId) continue;
        this.forgetSession(sid);
        const stale = this.clients.find((c) => c.sessionId === sid);
        if (stale) {
          try {
            stale.leave(CloseCode.CONSENTED);
          } catch {
            // Already gone -- nothing to clean up.
          }
        }
      }
      this.userIds.set(client.sessionId, userId);
    } else {
      // No identity: stop persisting for this connection. (The client flushes a final
      // saveProgress under the OLD id before sending `identify`.)
      this.userIds.delete(client.sessionId);
    }

    void this.loadProgress(client, userId, p);
  }

  // Sends the saved doc to just this client so it can hydrate its state ("progress"), or
  // "noProgress" when there is nothing to load (new account, guest, or Mongo unset). A failed read
  // sends "serverError" and keeps saving off, so a save that could not be read is never overwritten.
  private async loadProgress(client: Client, userId: string, p: PlayerState) {
    const players = getPlayers();
    let doc: PlayerDoc | null = null;
    if (userId && players) {
      try {
        doc = await players.findOne({ _id: userId });
      } catch (err) {
        console.warn("[WorldRoom] loadProgress failed", err);
        client.send("serverError", {});
        return;
      }
    }
    // The player may have left, or switched identity again, while the read was in flight.
    if (this.state.players.get(client.sessionId) !== p || (this.userIds.get(client.sessionId) ?? "") !== userId) return;

    this.loaded.add(client.sessionId);
    if (doc) this.progress.set(client.sessionId, sanitizeProgress(doc) ?? {});
    const now = Date.now();
    if (!doc) client.send("noProgress", { serverTime: now });
    else client.send("progress", { ...(sanitizeProgress(doc) ?? {}), serverTime: now });
    void this.sendLeaderboard(client);
  }
}
