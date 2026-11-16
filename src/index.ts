import { listen } from "@colyseus/tools";

import app from "./app.config.js";
import { connectDb } from "./db.js";
import { installReporters } from "./bloxity.js";

// Player-progress persistence (src/db.ts) connects before the room accepts
// players; connectDb() itself never throws or hangs (degrades to "no persistence").
await connectDb();

// Listens on PORT (or 2567).
listen(app);

// Boxity hosting reporters (live rooms, game stats, leaderboards): no-ops without the hosting variables.
installReporters();
