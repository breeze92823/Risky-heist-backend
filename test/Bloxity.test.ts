import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { __setFetchForTest, __setVerifierForTest, reportLeaderboards, reportRooms, reportStats, verifyAdReward, verifyToken } from "../src/bloxity.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { fakeVerify, testServer } from "./server.js";

type Call = { url: string; init: RequestInit; body: any };
// A fake network: records every request and answers with `reply(url, body)`.
function fakeNet(reply: (url: string, body: any) => unknown = () => ({ ok: true })) {
  const calls: Call[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), init, body });
    const out = reply(String(url), body);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  __setFetchForTest(fake);
  return calls;
}
const env = { ...process.env };
const hostingEnv = () => Object.assign(process.env, { BLOXITY_API_URL: "https://api.test", BLOXITY_GAME_ID: "risky-heist", BLOXITY_REPORT_TOKEN: "report-secret" });

describe("bloxity", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => {
    __setFetchForTest(null);
    __setVerifierForTest(fakeVerify);
    __setPlayersForTest(null);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  });

  describe("identity", () => {
    it("asks Bloxity who owns the token and uses only the id it returns", async () => {
      const calls = fakeNet(() => ({ valid: true, user: { _id: "acc42", username: "ann", displayName: "Ann" } }));
      process.env.BLOXITY_API_URL = "https://api.test";
      const user = await verifyToken("the-token");
      assert.strictEqual(user?._id, "acc42");
      assert.strictEqual(calls[0].url, "https://api.test/v1/auth/game-token/verify");
      assert.strictEqual((calls[0].init.headers as any).authorization, "Bearer the-token");
      assert.deepStrictEqual(calls[0].body, { gameSlug: "risky-heist" });
    });

    it("treats a refused token, no token or an unreachable Bloxity as a guest", async () => {
      fakeNet(() => new Response("{}", { status: 401 }));
      assert.strictEqual(await verifyToken("bad"), null);
      assert.strictEqual(await verifyToken(undefined), null);
      assert.strictEqual(await verifyToken(""), null);
      __setFetchForTest((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch);
      assert.strictEqual(await verifyToken("tok"), null);
    });

    it("never trusts an id the client sends: a forged userId is a guest and loads nothing", async () => {
      const fake = fakePlayers([{ _id: "victim", money: 999, version: 1, updatedAt: new Date() }]);
      __setPlayersForTest(fake);
      const room = await colyseus.createRoom<WorldState>("world", {});
      const c = await colyseus.connectTo(room, { userId: "victim", profileId: "victim", accountId: "victim", token: "forged" });
      let got: any = null;
      c.onMessage("progress", (m: any) => (got = m));
      c.onMessage("leaderboard", () => {});
      fake.release();
      await sleep(150);
      assert.strictEqual(got, null);
      assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, false);
      c.send("saveProgress", { money: 1 });
      await sleep(100);
      assert.strictEqual(fake.docs.get("victim")?.money, 999, "the victim's save is untouched");
    });

    it("signs in mid-session only with a token Bloxity accepts, and signs out with an empty one", async () => {
      const fake = fakePlayers([{ _id: "acc7", money: 77, version: 1, updatedAt: new Date() }]);
      __setPlayersForTest(fake);
      const room = await colyseus.createRoom<WorldState>("world", {});
      const c = await colyseus.connectTo(room, {});
      let got: any = null;
      c.onMessage("noProgress", () => {});
      c.onMessage("progress", (m: any) => (got = m));
      c.onMessage("leaderboard", () => {});
      fake.release();
      await sleep(100);
      c.send("identify", { userId: "acc7", username: "Evil" }); // an id alone changes nothing
      c.send("identify", { token: "refused" });
      await sleep(120);
      assert.strictEqual(got, null);
      assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, false);
      c.send("identify", { token: "tok-acc7" });
      await sleep(150);
      assert.strictEqual(got?.money, 77);
      assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, true);
      c.send("identify", { token: "" });
      await sleep(150);
      assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, false);
    });
  });

  describe("rewarded ads", () => {
    it("verifies the reward token with Bloxity and grants only a valid one", async () => {
      const calls = fakeNet((_u, body) => ({ valid: body.rewardToken === "good" }));
      process.env.BLOXITY_API_URL = "https://api.test";
      assert.strictEqual(await verifyAdReward("good"), true);
      assert.strictEqual(await verifyAdReward("used"), false);
      assert.strictEqual(await verifyAdReward(undefined), false);
      assert.strictEqual(calls[0].url, "https://api.test/v1/ads/reward/verify");
      assert.deepStrictEqual(calls[0].body, { gameSlug: "risky-heist", rewardToken: "good" });
    });

    it("answers the client's adReward message with the verdict", async () => {
      fakeNet((_u, body) => ({ valid: body.rewardToken === "good" }));
      const room = await colyseus.createRoom<WorldState>("world", {});
      const c = await colyseus.connectTo(room, {});
      const answers: any[] = [];
      c.onMessage("adRewardResult", (m: any) => answers.push(m));
      c.onMessage("noProgress", () => {});
      c.onMessage("leaderboard", () => {});
      c.send("adReward", { token: "good", placement: "free-cash" });
      c.send("adReward", { token: "forged", placement: "free-cash" });
      await sleep(200);
      assert.deepStrictEqual(answers.map((a) => a.ok).sort(), [false, true]);
      assert.ok(answers.every((a) => a.placement === "free-cash"));
    });
  });

  describe("reporters", () => {
    it("do nothing without the hosting variables", async () => {
      const calls = fakeNet();
      delete process.env.BLOXITY_GAME_ID;
      delete process.env.BLOXITY_REPORT_TOKEN;
      await reportStats();
      await reportLeaderboards();
      assert.strictEqual(calls.length, 0);
    });

    it("list the live rooms (players, size, locked) to the Bloxity matchmaker, so Open Rooms can show them", async () => {
      hostingEnv();
      process.env.MATCHMAKER_REPORT_URL = "https://mm.test/report/";
      process.env.POD_NAME = "pod-7";
      const calls = fakeNet();
      const room = await colyseus.createRoom<WorldState>("world", {});
      await colyseus.connectTo(room, { username: "A" });
      await colyseus.connectTo(room, { username: "B" });
      await sleep(100);
      await reportRooms();
      const post = calls.find((c) => c.url === "https://mm.test/report/risky-heist/rooms".replace("report//", "report/"))!;
      assert.ok(post, "posted to {MATCHMAKER_REPORT_URL}/{gameId}/rooms");
      assert.strictEqual((post.init.headers as any).authorization, "Bearer report-secret");
      assert.strictEqual(post.body.podName, "pod-7");
      const mine = post.body.rooms.find((r: any) => r.colyseusRoomId === room.roomId);
      assert.ok(mine, "this room is listed");
      assert.strictEqual(mine.name, "world");
      assert.strictEqual(mine.clients, 2);
      assert.strictEqual(mine.maxClients, 6, "the room size the matchmaker sizes pods from");
      assert.strictEqual(mine.locked, false);
      assert.ok(post.body.players >= 2);
    });

    it("do nothing for rooms without MATCHMAKER_REPORT_URL, and never throw when the matchmaker is down", async () => {
      hostingEnv();
      delete process.env.MATCHMAKER_REPORT_URL;
      let calls = fakeNet();
      await reportRooms();
      assert.strictEqual(calls.length, 0);
      process.env.MATCHMAKER_REPORT_URL = "https://mm.test";
      __setFetchForTest((async () => {
        throw new Error("matchmaker down");
      }) as unknown as typeof fetch);
      await reportRooms(); // must resolve
      calls = fakeNet();
    });

    it("report the signed-in players' stats and scores from the server's copy, never guests'", async () => {
      hostingEnv();
      const calls = fakeNet();
      const fake = fakePlayers([{ _id: "acc1", rebirths: 3, stats: { stolen: 9, heists: 4, earned: 5e15, busts: 1, bestId: null, maxFloor: 12 }, version: 1, updatedAt: new Date() }]);
      __setPlayersForTest(fake);
      const room = await colyseus.createRoom<WorldState>("world", {});
      const c = await colyseus.connectTo(room, { token: "tok-acc1" });
      const g = await colyseus.connectTo(room, { username: "Guest" });
      for (const cl of [c, g]) {
        cl.onMessage("progress", () => {});
        cl.onMessage("noProgress", () => {});
        cl.onMessage("leaderboard", () => {});
      }
      fake.release();
      await sleep(200);

      await reportStats();
      const stats = calls.find((x) => x.url === "https://api.test/v1/games/risky-heist/stats")!;
      assert.strictEqual((stats.init.headers as any).authorization, "Bearer report-secret");
      assert.deepStrictEqual(stats.body.players.map((p: any) => p.userId), ["legion_acc1"], "guests are never reported");
      const v = stats.body.players[0].values;
      assert.strictEqual(v.rebirths, 3);
      assert.strictEqual(v.max_floor, 12);
      assert.strictEqual(v.items_stolen, 9);
      assert.strictEqual(v.cash_earned, 1e12, "clamped to the currency ceiling (Boxity rejects above it)");
      assert.ok(stats.body.definitions.length <= 50 && stats.body.definitions.every((d: any) => /^[a-z0-9_]{1,32}$/.test(d.key) && d.label.length <= 40));

      await reportLeaderboards();
      const lb = calls.find((x) => x.url === "https://api.test/v1/leaderboards/hosted/risky-heist/report")!;
      assert.deepStrictEqual(lb.body.boards.map((b: any) => b.id).sort(), ["earned", "maxfloor", "rebirths", "stolen"]);
      const score = (board: string) => lb.body.scores.find((s: any) => s.board === board);
      assert.deepStrictEqual(score("rebirths"), { board: "rebirths", userId: "legion_acc1", score: 3 });
      assert.strictEqual(score("maxfloor").score, 12);
      assert.ok(lb.body.scores.every((s: any) => s.userId === "legion_acc1"));

      const before = calls.length;
      await reportLeaderboards();
      assert.strictEqual(calls.length, before, "unchanged scores are not re-sent");
    });
  });
});
