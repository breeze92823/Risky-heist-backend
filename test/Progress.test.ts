import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("progress", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("sends a saved player their progress and saves what they send back", async () => {
    const fake = fakePlayers([
      { _id: "u1", money: 5000, tool: 2, owned: [0, 1, 2], slots: [{ id: "coin", stored: 40 }], carried: ["ruby"], rebirths: 2, version: 1, updatedAt: new Date() },
    ]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { token: "tok-u1", username: "Ann" });
    let got: any = null;
    c.onMessage("progress", (m: any) => (got = m));
    c.onMessage("leaderboard", () => {});
    fake.release();
    await sleep(150);
    assert.strictEqual(got?.money, 5000);
    assert.strictEqual(got?.tool, 2);
    assert.deepStrictEqual(got?.owned, [0, 1, 2]);
    assert.deepStrictEqual(got?.slots, [{ id: "coin", stored: 40 }]);
    assert.deepStrictEqual(got?.carried, ["ruby"]);
    assert.ok(typeof got?.serverTime === "number");

    c.send("saveProgress", {
      money: 7000, carryCap: 2, tool: 3, owned: [0, 1, 2, 3], slots: [{ id: "ruby", stored: 0 }, { id: null, stored: 0 }], carried: [],
      stats: { stolen: 4, heists: 1, earned: 9000, busts: 0, bestId: "ruby", maxFloor: 6 }, hack: 1,
    });
    await sleep(150);
    const doc = fake.docs.get("u1")! as any;
    assert.strictEqual(doc.money, 7000);
    assert.strictEqual(doc.tool, 3);
    assert.deepStrictEqual(doc.slots, [{ id: "ruby", stored: 0 }, { id: null, stored: 0 }]);
    assert.strictEqual(doc.stats.maxFloor, 6);
    assert.strictEqual(doc.rebirths, 2, "fields a save leaves out are kept");
    assert.strictEqual(doc.username, "u1", "the name is the verified account's, not the one the client sent");
    assert.ok(!("hack" in doc));
  });

  it("creates a new account's save and never saves a guest", async () => {
    const fake = fakePlayers();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { token: "tok-new1" });
    let none = false;
    c.onMessage("noProgress", () => (none = true));
    c.onMessage("leaderboard", () => {});
    fake.release();
    await sleep(150);
    assert.ok(none);
    c.send("saveProgress", { money: 10 });
    await sleep(150);
    assert.strictEqual(fake.docs.get("new1")?.money, 10);

    const guest = await colyseus.connectTo(room, {});
    guest.onMessage("noProgress", () => {});
    guest.onMessage("leaderboard", () => {});
    await sleep(150);
    guest.send("saveProgress", { money: 99 });
    await sleep(150);
    assert.strictEqual(fake.docs.size, 1, "a guest is never written");
    assert.strictEqual(room.state.players.get(guest.sessionId)?.signedIn, false);
  });

  it("loads the new identity when a guest signs in mid-session", async () => {
    const fake = fakePlayers([{ _id: "u2", money: 42, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, {});
    let got: any = null;
    c.onMessage("noProgress", () => {});
    c.onMessage("progress", (m: any) => (got = m));
    c.onMessage("leaderboard", () => {});
    fake.release();
    await sleep(150);
    c.send("identify", { token: "tok-u2", username: "Bea" });
    await sleep(150);
    assert.strictEqual(got?.money, 42);
    assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, true);
  });

  it("keeps saving off when the save could not be read", async () => {
    const fake = fakePlayers([{ _id: "u3", money: 1e9, version: 1, updatedAt: new Date() }]);
    (fake as any).findOne = async () => {
      await fake.gate;
      throw new Error("down");
    };
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { token: "tok-u3" });
    let failed = false;
    c.onMessage("serverError", () => (failed = true));
    fake.release();
    await sleep(150);
    assert.ok(failed);
    c.send("saveProgress", { money: 0 });
    await sleep(150);
    assert.strictEqual(fake.docs.get("u3")!.money, 1e9, "the unread save is never overwritten");
  });
});
