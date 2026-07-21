import { PathService } from "../core/paths/path-service.js";
import { LockManager } from "../core/locks/lock-manager.js";
import { RunManager } from "../core/runs/run-manager.js";
import { ManagedSessionHost } from "../core/sessions/session-host.js";
import { ManagedSessionManager } from "../core/sessions/session-manager.js";
import type { ManagedSessionHostLaunch } from "../core/sessions/session-host.js";
import type { SerialPortSessionTransportOptions } from "./serialport-session-transport.js";
import { SerialPortSessionTransport } from "./serialport-session-transport.js";
import { RLogBusinessLogFactory } from "./rlog-business-log.js";

interface SerialSessionHostLaunch {
  readonly schema: "benchpilot.serial-session-host-launch";
  readonly version: 1;
  readonly host: ManagedSessionHostLaunch;
  readonly serial: SerialPortSessionTransportOptions;
}

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const sessionId = argument("--session-id");
if (!sessionId) throw new Error("Managed session host requires --session-id.");

const paths = new PathService();
const sessions = new ManagedSessionManager(paths);
const launch =
  await sessions.store.readLaunch<SerialSessionHostLaunch>(sessionId);
if (
  !launch ||
  launch.schema !== "benchpilot.serial-session-host-launch" ||
  launch.version !== 1 ||
  launch.host.permit.sessionId !== sessionId
)
  throw new Error("Managed session host launch record is invalid.");
await sessions.store.removeLaunch(sessionId);
const session = await sessions.get(sessionId);
if (!session) throw new Error("Managed session record is missing.");
const host = new ManagedSessionHost(launch.host, {
  sessions,
  locks: new LockManager(paths),
  runs: new RunManager(paths, session.projectRoot),
  businessLogs: new RLogBusinessLogFactory(),
  createTransport: async () => new SerialPortSessionTransport(launch.serial),
});
await host.run();
