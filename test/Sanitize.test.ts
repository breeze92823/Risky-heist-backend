import assert from "assert";

import { CARRY_MAX, CURRENCY_MAX, DAILY_DAYS, SLOTS_MAX } from "../src/constants.js";
import { sanitizeProgress } from "../src/sanitize.js";

describe("sanitizeProgress", () => {
  it("rejects non-objects and bounds numbers", () => {
    assert.strictEqual(sanitizeProgress(null), null);
    assert.strictEqual(sanitizeProgress([1]), null);
    const out = sanitizeProgress({ money: 1e40, rebirths: 3.7, carryCap: 0, unlocked: 1e9, tool: -4, lastSeen: NaN, hack: "x" })!;
    assert.strictEqual(out.money, CURRENCY_MAX);
    assert.strictEqual(out.rebirths, 3);
    assert.strictEqual(out.carryCap, 1, "at least one carry slot");
    assert.strictEqual(out.unlocked, SLOTS_MAX);
    assert.strictEqual(out.tool, 0);
    assert.strictEqual(out.lastSeen, undefined);
    assert.ok(!("hack" in out));
    assert.strictEqual(sanitizeProgress({ money: -5 })!.money, 0);
    assert.strictEqual(sanitizeProgress({ money: "9" })!.money, undefined);
  });

  it("keeps base slots in position, with bad ids and amounts emptied", () => {
    const out = sanitizeProgress({
      slots: [{ id: "coin", stored: 12.5 }, { id: null, stored: 0 }, { id: "Bad Id!", stored: -3 }, { id: "coin", stored: "x" }, "junk"],
    })!;
    assert.deepStrictEqual(out.slots, [
      { id: "coin", stored: 12.5 },
      { id: null, stored: 0 },
      { id: null, stored: 0 },
      { id: "coin", stored: 0 },
      { id: null, stored: 0 },
    ]);
    assert.strictEqual(sanitizeProgress({ slots: Array.from({ length: 500 }, () => ({ id: "coin", stored: 0 })) })!.slots!.length, SLOTS_MAX);
  });

  it("keeps carried treasures (repeats allowed) and a distinct Index", () => {
    const out = sanitizeProgress({ carried: ["coin", "coin", "Bad Id!", 7, "ruby"], discovered: ["coin", "coin", "ruby", "no way"] })!;
    assert.deepStrictEqual(out.carried, ["coin", "coin", "ruby"]);
    assert.deepStrictEqual(out.discovered, ["coin", "ruby"]);
    assert.strictEqual(sanitizeProgress({ carried: Array.from({ length: 500 }, () => "coin") })!.carried!.length, CARRY_MAX);
  });

  it("keeps owned tool indexes whole, in range and distinct", () => {
    assert.deepStrictEqual(sanitizeProgress({ owned: [3, 0, 3, 1.5, -1, 9999, "2"] })!.owned, [0, 3]);
  });

  it("bounds the Daily Gifts, stats and timed spawns", () => {
    const out = sanitizeProgress({
      daily: { day: 99, claimed: [true, 1, false, true], nextAt: 1_700_000_000_000 },
      stats: { stolen: 10.9, heists: -1, earned: 5e9, busts: "x", bestId: "Bad Id!", maxFloor: 0 },
      spawns: { legendary: 1_700_000_000_000, "bad key!": 5, rare: "soon" },
      pending: { legendary: true, secret: "yes" },
    })!;
    assert.strictEqual(out.daily!.day, DAILY_DAYS);
    assert.deepStrictEqual(out.daily!.claimed, [true, false, false, true, false, false, false]);
    assert.strictEqual(out.daily!.nextAt, 1_700_000_000_000);
    assert.deepStrictEqual(out.stats, { stolen: 10, heists: 0, earned: 5e9, busts: 0, bestId: null, maxFloor: 1 });
    assert.deepStrictEqual(out.spawns, { legendary: 1_700_000_000_000 });
    assert.deepStrictEqual(out.pending, { legendary: true });
  });

  it("is idempotent, so a doc read back from Mongo comes out the same", () => {
    const once = sanitizeProgress({
      money: 5, carryCap: 3, unlocked: 4, tool: 2, owned: [0, 2], slots: [{ id: "coin", stored: 1 }], carried: ["ruby"], discovered: ["coin"],
      rebirths: 1, daily: { day: 2, claimed: [true], nextAt: 5 }, stats: { stolen: 1, maxFloor: 3, bestId: "ruby" }, spawns: { rare: 9 }, pending: {}, lastSeen: 1000,
    })!;
    assert.deepStrictEqual(sanitizeProgress(once), once);
  });
});
