export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(value: string): NodeVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isSupportedNodeVersion(value: string): boolean {
  const version = parseNodeVersion(value);
  if (!version) return false;
  return version.major > 22 || (version.major === 22 && version.minor >= 13);
}
