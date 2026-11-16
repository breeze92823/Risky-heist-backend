import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { ROOM_MAX_CLIENTS, SLOTS_MAX } from "../src/constants.js";
import { sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("bases", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());

  it("holds 6 players, one hub plot each", async () => {
    assert.strictEqual(ROOM_MAX_CLIENTS, 6);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const clients = [];
    for (let i = 0; i < ROOM_MAX_CLIENTS; i++) clients.push(await colyseus.connectTo(room, { username: `P${i}` }));
    await sleep(50);
    const plots = clients.map((c) => room.state.players.get(c.sessionId)!.base).sort();
    assert.deepStrictEqual(plots, [0, 1, 2, 3, 4, 5], "every plot is owned by exactly one player");
    assert.strictEqual(room.clients.length, ROOM_MAX_CLIENTS);
    await assert.rejects(colyseus.connectTo(room, {}), "a 7th player is refused (the matchmaker opens another room)");
  });

  it("gives a freed plot to the next player and never moves the others", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, {});
    const b = await colyseus.connectTo(room, {});
    const c = await colyseus.connectTo(room, {});
    await sleep(50);
    const plot = (cl: typeof a) => room.state.players.get(cl.sessionId)!.base;
    assert.deepStrictEqual([plot(a), plot(b), plot(c)], [0, 1, 2]);
    await b.leave();
    await sleep(100);
    const d = await colyseus.connectTo(room, {});
    await sleep(50);
    assert.strictEqual(plot(d), 1, "the plot b left goes to the newcomer");
    assert.deepStrictEqual([plot(a), plot(c)], [0, 2], "nobody else is moved");
  });

  it("relays each base's slots to the others, bounded", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, {});
    const b = await colyseus.connectTo(room, {});
    await sleep(50);
    a.send("setBase", { unlocked: 4, items: ["coin", "", "ruby", "Bad Id!", 7, null] });
    await sleep(80);
    const p = room.state.players.get(a.sessionId)!;
    assert.strictEqual(p.baseUnlocked, 4);
    assert.strictEqual(p.baseItems, "coin,,ruby,,,");

    a.send("setBase", { unlocked: 1e9, items: Array.from({ length: 500 }, () => "coin") });
    await sleep(80);
    assert.strictEqual(p.baseUnlocked, SLOTS_MAX);
    assert.strictEqual(p.baseItems.split(",").length, SLOTS_MAX);

    // b's synced copy of the roster sees a's plot and contents.
    const seen = (b.state as any).players.get(a.sessionId);
    assert.strictEqual(seen.base, 0);
    assert.strictEqual(seen.baseUnlocked, SLOTS_MAX);
  });
});
