import {
  LockManager,
  ManagedSessionHost,
  ManagedSessionManager,
  PathService,
  RunManager,
} from "../../dist/core.js";
import { RLogBusinessLogFactory } from "../../dist/infrastructure/rlog-business-log.js";

const sessionId = process.argv.at(process.argv.indexOf("--session-id") + 1);
if (!sessionId)
  throw new Error("Managed session host fixture requires --session-id.");

const paths = new PathService();
const sessions = new ManagedSessionManager(paths);
const launchDelayMs = Number(process.env.BENCHPILOT_TEST_SESSION_HOST_DELAY_MS);
if (Number.isSafeInteger(launchDelayMs) && launchDelayMs > 0)
  await new Promise((resolve) => setTimeout(resolve, launchDelayMs));
const launch = await sessions.store.readLaunch(sessionId);
if (
  !launch ||
  launch.schema !== "benchpilot.serial-session-host-launch" ||
  launch.version !== 1 ||
  launch.host.permit.sessionId !== sessionId
)
  throw new Error("Managed session host fixture launch record is invalid.");
await sessions.store.removeLaunch(sessionId);
const session = await sessions.get(sessionId);
if (!session)
  throw new Error("Managed session host fixture record is missing.");

const host = new ManagedSessionHost(launch.host, {
  sessions,
  locks: new LockManager(paths),
  runs: new RunManager(paths, session.projectRoot),
  businessLogs: new RLogBusinessLogFactory(),
  createTransport: async () => ({
    async open() {
      if (process.env.BENCHPILOT_TEST_SESSION_HOST_FAIL === "1")
        throw new Error("fixture serial transport failed to open");
    },
    async close() {},
    async write(data) {
      return data.byteLength;
    },
    onData() {
      return () => {};
    },
  }),
});
await host.run();
