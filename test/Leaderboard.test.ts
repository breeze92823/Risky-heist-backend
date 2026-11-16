import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest, type PlayerDoc } from "../src/db.js";
import { LEADERBOARD_SIZE } from "../src/constants.js";
import { __resetLeaderboardForTest } from "../src/leaderboard.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

const doc = (id: string, f: Partial<PlayerDoc>): PlayerDoc => ({ _id: id, version: 1, updatedAt: new Date(), ...f });
const stats = (s: Partial<NonNullable<PlayerDoc["stats"]>>): NonNullable<PlayerDoc["stats"]> => ({ stolen: 0, heists: 0, earned: 0, busts: 0, bestId: null, maxFloor: 1, ...s });

describe("leaderboard", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => {
    await colyseus.cleanup();
    __resetLeaderboardForTest();
  });
  afterEach(() => __setPlayersForTest(null));

  it("sends the top saved players per stat and the player's own ranks after the load", async () => {
    const seed = [
      doc("u1", { username: "Ann", rebirths: 3, stats: stats({ earned: 500, maxFloor: 20, stolen: 10 }) }),
      doc("u2", { username: "Bo", rebirths: 9, stats: stats({ earned: 100, maxFloor: 1 }) }),
      ...Array.from({ length: 15 }, (_, i) => doc(`x${i}`, { username: `P${i}`, stats: stats({ earned: 1000 + i, maxFloor: 2 }) })),
    ];
    const fake = fakePlayers(seed);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { token: "tok-u1", username: "Ann" });
    let got: any = null;
    c.onMessage("leaderboard", (m: any) => (got = m));
    c.onMessage("progress", () => {});
    fake.release();
    await sleep(200);
    assert.ok(got, "leaderboard sent after the load");
    assert.deepStrictEqual(got.boards.rebirths, [{ name: "Bo", value: 9 }, { name: "Ann", value: 3 }]);
    assert.strictEqual(got.boards.earned.length, LEADERBOARD_SIZE);
    assert.deepStrictEqual(got.boards.earned[0], { name: "P14", value: 1014 });
    assert.deepStrictEqual(got.boards.stolen, [{ name: "Ann", value: 10 }], "players without a score are left out");
    assert.deepStrictEqual(got.boards.maxFloor[0], { name: "Ann", value: 20 });
    assert.deepStrictEqual(got.ranks, { rebirths: 2, earned: 16, maxFloor: 1, stolen: 1 });
  });

  it("gives a player with no save the lists and no ranks", async () => {
    const fake = fakePlayers([doc("u1", { username: "Ann", rebirths: 3 })]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { token: "tok-u9", username: "New" });
    let got: any = null;
    c.onMessage("leaderboard", (m: any) => (got = m));
    c.onMessage("noProgress", () => {});
    fake.release();
    await sleep(200);
    assert.deepStrictEqual(got?.boards.rebirths, [{ name: "Ann", value: 3 }]);
    assert.deepStrictEqual(got?.ranks, { rebirths: null, earned: null, maxFloor: null, stolen: null });
  });
});
