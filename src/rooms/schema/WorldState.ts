import { schema, t, type SchemaType } from "@colyseus/schema";

// The live roster: who is in the room. Durable progress lives in Mongo (src/db.ts).
// To sync something new about a player, add a field here and accept it in a WorldRoom message.
export const PlayerState = schema(
  {
    username: t.string().default(""), // client-reported Bloxity displayName/username, not validated
    signedIn: t.boolean().default(false), // has a Bloxity id: only signed-in players are saved
    pfp: t.string().default(""), // Bloxity profile picture URL ("" = none)
    // The verified Bloxity account id ("" = guest). Public on purpose: Boxity's chat messages carry the
    // sender's userId, which is how a client finds the character a bubble belongs to.
    userId: t.string().default(""),
    emote: t.string().default(""), // the portal emote this player is playing ("" = none)
    grounded: t.boolean().default(true), // on the floor (false in the air / on the zipline), for the others' animation
    carry: t.string().default(""), // the best treasure id this player carries ("" = none): shown floating over their head
    riding: t.boolean().default(false), // on the zipline: hanging pose + trolley
    swing: t.boolean().default(false), // hitting a door: the arm swing
    // The hub plot this player owns (0..ROOM_MAX_CLIENTS-1, assigned on join, unique in the room,
    // -1 = none) and what its base shows the others (presence.ts `setBase`).
    base: t.int8().default(-1),
    baseUnlocked: t.uint8().default(0), // slots unlocked (the rest show padlocks)
    baseItems: t.string().default(""), // treasure id per slot, comma separated ("" = empty slot)
    // Presence (presence.ts, `pose` / `setAvatar`): what the others draw in the world.
    x: t.float64().default(0), // feet position, m
    y: t.float64().default(0),
    z: t.float64().default(0),
    yaw: t.float32().default(0), // heading, rad (PI = facing north, -Z)
    speed: t.float32().default(0), // m/s
    avatar: t.string().default(""), // Bloxity look JSON { equipped, proportions, skin }, "" = default
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState), // keyed by sessionId
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
