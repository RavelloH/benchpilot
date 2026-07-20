import type { JsonObject } from "../../contracts/index.js";
import type { StaticOutputDefinition } from "../output/engine.js";
import { renderVersion } from "../presentation/version.js";

export type VersionData = JsonObject & {
  readonly schema: "benchpilot.version";
  readonly version: 1;
  readonly cliVersion: string;
  readonly nodeVersion: string;
};

export const versionOutputDefinition = (input: {
  readonly cliVersion: string;
  readonly nodeVersion: string;
  readonly showWordmark: boolean;
}): StaticOutputDefinition<VersionData> => {
  const data: VersionData = {
    schema: "benchpilot.version",
    version: 1,
    cliVersion: input.cliVersion,
    nodeVersion: input.nodeVersion,
  };
  return {
    command: { id: "version", path: ["version"] },
    kind: "data",
    data,
    snapshots: [{ key: "version", value: data }],
    renderScreen(value, context) {
      return renderVersion(
        value,
        context.color,
        input.showWordmark,
        context.columns,
      );
    },
  };
};
