import type { AdapterDiagnostic } from "./types.js";

export const diagnostic = (
  code: string,
  file: string,
  message: string,
  path?: string,
  adapterId?: string,
): AdapterDiagnostic => ({
  severity: "error",
  code,
  file,
  message,
  path,
  adapterId,
});

export const hasErrors = (diagnostics: AdapterDiagnostic[]) =>
  diagnostics.some((item) => item.severity === "error");
