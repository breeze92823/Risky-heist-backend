# Bloxity code metadata

Read by the Boxity MCP (`audit_sdk` / `integrate_sdk`). Keep it in step with the code.

- `gameSlug`: `risky-heist`
- `clientDir`: `../Risky-heist` (this repo is the game server; the client lives next to it)
- `buildCommand`: `npm run build` (tsc -> `build/`)
- `distDir`: `build`
- `canDie`: **true**. Getting busted (Jail Chance reaches 100%) is the game's death: the carried loot is lost and the player is sent home. It shows Boxity's death screen (`src/heist/game.js` `bust()`, `src/heist/hud.js` `deathPrompt()`): the Respawn button stays disabled until `death.onCountdown` reaches 0, then `death.respawn()` decides. "Reset Character" (`respawn_request`) stays instant and separate.
- `hasScore`: **true**. Boards (declared in `src/config.js` `LEADERBOARDS`, reported by the game server, never by the client): `rebirths`, `earned` (cash earned), `maxfloor` (highest floor), `stolen` (treasures stolen).
- Server (`../Risky-heist-backend`, hosted on Boxity): verifies the player's token with Bloxity (`onAuth`), reports game stats, leaderboard scores and live rooms, verifies rewarded-ad tokens.

## Features

| Feature | Status |
| --- | --- |
| Init, `loadingStep` / `loadingEnd`, `gameplayStart` / `gameplayEnd` | done (`src/bloxity.js`) |
| Environments (`environment()`, `onEnvironmentChanged`) | done: no hardcoded Bloxity URL, no hostname checks in the client; the server reads `BLOXITY_*` |
| Platform UI rules (no own menu / chat / emotes / invite / leaderboard / sign-in; Esc opens `portal.showMenu`; HUD out of the reserved top-left area) | done |
| Auth + server identity (`getToken`, server verifies via `/v1/auth/game-token/verify`, only the returned `user._id` is used) | done |
| Settings (`master_volume`, `graphics_quality`, `camera_sensitivity`, `show_fps`, `fullscreen`) | done |
| Avatar / cosmetics (manual path in `src/avatar/`) | done, for every player: each client sends its equipped ids + proportions (never URLs) and rebuilds the others from them (`src/avatar/remotePlayers.js`) |
| Emotes (`registerFeature('emotes')`, `play_emote` / `stop_emote`, catalogue clips on the rig) | done, replicated: the emote id goes through the server and plays on that player's character for everyone |
| Chat bubbles (`chat.onMessage`, `attachBubble`) | done for every player: `m.userId` is matched to the character whose server-verified account id it is |
| Death screen | done (see `canDie`) |
| Ads: ad breaks (pause + mute), screen ads (`declareScreens`, `ads.screen` for `panel`, `gameplay` off), rewarded ad (`free-cash`, token verified by the server) | done |
| Leaderboards | done (`hasScore`) |
| Game stats (server reporter, every 60 s + on SIGTERM) | done |
| Rooms: `updateRoom`, `playerJoined`, `playerInRoom`, `?roomId=` launch join, live-room reporter, `maxClients` = 6 = `roomSize` | done |
| Party play (matchmaker, SDK from `/v1/legion-sdk.min.js`) | automatic through the matchmaker |

## Not applicable / not done

- **Gems purchases (`gems.requestPurchase`, webhook)**: not applicable by design. This game never sells anything for premium currency (see the root `CLAUDE.md`); everything is bought with cash.
- **CrazyGames / `play_with_friends`**: not registered. The game has no private-room flow of its own; joining is the matchmaker's room plus `?roomId=`.
- **Guest progress carry-over (`carriedFrom`)**: guests are never saved, so there is no guest progress to copy.
- **Hub games, Unity**: not applicable.
