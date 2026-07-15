import { AdapterBundleLoader } from "./bundle-loader.js";
import type {
  CompiledAdapterIndexEntry,
  RuntimeAdapter,
  RuntimePlatform,
} from "./types.js";

const platformFor = (): RuntimePlatform => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
};

export class RuntimeAdapterRegistry {
  constructor(
    private readonly loader = new AdapterBundleLoader(),
    private readonly platform = platformFor(),
  ) {}

  async list(): Promise<ReadonlyArray<Readonly<CompiledAdapterIndexEntry>>> {
    return this.loader.loadIndex();
  }

  async has(id: string) {
    return (await this.loader.loadIndex()).some((adapter) => adapter.id === id);
  }

  async get(id: string): Promise<RuntimeAdapter> {
    return this.loader.loadForPlatform(id, this.platform);
  }
}
