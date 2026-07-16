import { realpathSync } from "node:fs";
import path from "node:path";

/** Produces the same physical identity for equivalent port spellings. */
export const normalizePortIdentity = (
  port: string,
  platform = process.platform,
) => {
  const value = port.trim();
  if (platform === "win32") {
    const normalized = value.replace(/^\\\\\.\\/, "").toUpperCase();
    return /^COM\d+$/.test(normalized) ? normalized : value.toUpperCase();
  }
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};
