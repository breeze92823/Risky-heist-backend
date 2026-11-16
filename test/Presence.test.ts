import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { AVATAR_MAX_LEN, POSE_BOUNDS } from "../src/constants.js";
import { sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("presence", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());

  it("takes the pose and look from the join options", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { pose: { x: 3, y: 0.5, z: -12, yaw: Math.PI, speed: 4 }, avatar: '{"equipped":{}}' });
    await sleep(50);
    const p = room.state.players.get(a.sessionId)!;
    assert.deepStrictEqual([p.x, p.y, p.z, p.speed], [3, 0.5, -12, 4]);
    assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 1e-5);
    assert.strictEqual(p.avatar, '{"equipped":{}}');
  });

  it("bounds poses and looks and relays them to the others", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, {});
    const b = await colyseus.connectTo(room, {});
    await sleep(50);
    a.send("pose", { x: 1e9, y: "high", z: -1e12, yaw: 7, speed: -3 });
    a.send("setAvatar", { avatar: "x".repeat(AVATAR_MAX_LEN + 1) });
    await sleep(100);
    const p = room.state.players.get(a.sessionId)!;
    assert.strictEqual(p.x, POSE_BOUNDS.xy);
    assert.strictEqual(p.y, 0, "a non-number is ignored");
    assert.strictEqual(p.z, -POSE_BOUNDS.xy);
    assert.ok(Math.abs(p.yaw - Math.atan2(Math.sin(7), Math.cos(7))) < 1e-5, "yaw wrapped to -PI..PI");
    assert.strictEqual(p.speed, 0);
    assert.strictEqual(p.avatar, "", "an oversized look is ignored");

    // b's synced copy of the roster sees a's presence.
    const seen = (b.state as any).players.get(a.sessionId);
    assert.strictEqual(seen.x, POSE_BOUNDS.xy);
  });

  it("relays the emote, the grounded flag and the verified account id (never a client-sent one)", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { token: "tok-acc5" });
    const g = await colyseus.connectTo(room, { userId: "acc5", token: "forged" });
    await sleep(100);
    const pa = room.state.players.get(a.sessionId)!;
    const pg = room.state.players.get(g.sessionId)!;
    assert.strictEqual(pa.userId, "acc5", "the id Bloxity verified");
    assert.strictEqual(pg.userId, "", "a guest has none, whatever it claims");
    assert.deepStrictEqual([pa.emote, pa.grounded], ["", true]);

    a.send("emote", { id: "emote123" });
    a.send("pose", { x: 1, grounded: false });
    await sleep(80);
    assert.strictEqual(pa.emote, "emote123");
    assert.strictEqual(pa.grounded, false);
    a.send("emote", { id: "Bad Id!" });
    a.send("emote", { id: 7 });
    await sleep(80);
    assert.strictEqual(pa.emote, "emote123", "a malformed id is ignored");
    a.send("emote", { id: "" });
    a.send("pose", { grounded: "yes" });
    await sleep(80);
    assert.strictEqual(pa.emote, "", "an empty id stops it");
    assert.strictEqual(pa.grounded, false, "a non-boolean is ignored");

    // the others' synced copy of the roster sees it
    const seen = (g.state as any).players.get(a.sessionId);
    assert.strictEqual(seen.userId, "acc5");
  });

  it("relays what the player carries, the zipline ride and the door swing, bounded", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, {});
    const b = await colyseus.connectTo(room, {});
    await sleep(60);
    const p = room.state.players.get(a.sessionId)!;
    assert.deepStrictEqual([p.carry, p.riding, p.swing], ["", false, false]);
    a.send("pose", { carry: "ruby", riding: true, swing: true });
    await sleep(80);
    assert.deepStrictEqual([p.carry, p.riding, p.swing], ["ruby", true, true]);
    a.send("pose", { carry: "Bad Id!", riding: "yes", swing: 1 });
    await sleep(80);
    assert.deepStrictEqual([p.carry, p.riding, p.swing], ["ruby", true, true], "malformed values are ignored");
    a.send("pose", { carry: "", riding: false, swing: false });
    await sleep(80);
    assert.deepStrictEqual([p.carry, p.riding, p.swing], ["", false, false]);
    a.send("pose", { carry: "diamond", riding: true });
    await sleep(80);
    const seen = (b.state as any).players.get(a.sessionId);
    assert.deepStrictEqual([seen.carry, seen.riding], ["diamond", true]);
  });
});
