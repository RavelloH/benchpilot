import type { InitializeProjectResult } from "../../application/init/use-case.js";
import type { CliDataPage } from "./page.js";

export interface InitData extends InitializeProjectResult {
  readonly schema: "benchpilot.init";
  readonly version: 1;
}

/** Presents the initialized project while retaining a natural machine DTO. */
export const initDataPage = (
  result: InitializeProjectResult,
): CliDataPage<InitData> => {
  const data: InitData = {
    schema: "benchpilot.init",
    version: 1,
    ...result,
  };
  return {
    data,
    jsonl: [{ key: "project", value: data.project }],
  };
};
