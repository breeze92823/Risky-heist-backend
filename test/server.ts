import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { __setVerifierForTest, type VerifiedUser } from "../src/bloxity.js";

// A stand-in for Bloxity's token check: the token "tok-<id>" belongs to account <id> (named <id>);
// anything else is refused, like a guest's missing / expired token.
export const fakeVerify = async (token: unknown): Promise<VerifiedUser | null> =>
  typeof token === "string" && token.startsWith("tok-") ? { _id: token.slice(4), username: token.slice(4), displayName: token.slice(4) } : null;

// One test server for every test file: booting appConfig twice in one mocha run breaks the second
// boot. Mocha's --exit tears it down at the end.
let server: Promise<ColyseusTestServer<typeof appConfig>> | null = null;
export const testServer = () => {
  __setVerifierForTest(fakeVerify);
  return (server ??= boot(appConfig));
};
