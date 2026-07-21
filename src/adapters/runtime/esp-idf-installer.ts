import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  BenchPilotError,
  type AdapterInstallation,
  type Json,
  type OperationReporter,
} from "../../core.js";
import { runProcess } from "../../core/process/process-runner.js";

const EIM_RELEASE_API =
  "https://api.github.com/repos/espressif/idf-im-ui/releases/latest";
const EIM_RELEASE_PAGE =
  "https://github.com/espressif/idf-im-ui/releases/expanded_assets";
const EIM_LATEST_RELEASE_PAGE =
  "https://github.com/espressif/idf-im-ui/releases/latest";
const ESP_IDF_VERSION = "v5.5.2";
const installEstimate = {
  minimumBytes: 5_000_000_000,
  maximumBytes: 12_000_000_000,
} as const;

type Platform = "windows" | "linux" | "macos";

interface GithubAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly digest?: string;
}

interface GithubRelease {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
  readonly assets: readonly GithubAsset[];
}

interface EimStateInstallation {
  readonly id?: string;
  readonly name?: string;
  readonly path?: string;
  readonly python?: string;
  readonly activationScript?: string;
  readonly idfToolsPath?: string;
}

interface EimState {
  readonly idfSelectedId?: string;
  readonly idfInstalled?: readonly EimStateInstallation[];
}

interface EimAsset {
  readonly asset: GithubAsset;
  readonly digest: string;
  readonly tag: string;
}

interface WindowsSideEffects {
  readonly userPath: readonly string[];
  readonly desktopShortcuts: ReadonlySet<string>;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const string = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const installationError = (message: string, details: Json = {}) =>
  new BenchPilotError(
    "ADAPTER_INSTALLATION_FAILED",
    5,
    message,
    false,
    undefined,
    [],
    details,
  );

const platformFor = (): Platform =>
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "linux";

const eimAssetName = (
  platform: Platform,
  architecture: NodeJS.Architecture = process.arch,
) => {
  if (platform === "windows" && architecture === "x64")
    return "eim-cli-windows-x64.exe";
  if (platform === "linux" && architecture === "x64")
    return "eim-cli-linux-x64.zip";
  if (platform === "macos" && architecture === "x64")
    return "eim-cli-macos-x64.zip";
  if (platform === "macos" && architecture === "arm64")
    return "eim-cli-macos-aarch64.zip";
  throw installationError(
    `ESP-IDF installation is not available for ${platform}/${architecture}.`,
  );
};

const digestFromAssetPage = async (
  tag: string,
  assetName: string,
  request: typeof fetch,
) => {
  const response = await request(
    `${EIM_RELEASE_PAGE}/${encodeURIComponent(tag)}`,
    {
      headers: { Accept: "text/html" },
    },
  );
  if (!response.ok)
    throw installationError(
      "GitHub did not provide a checksum for the EIM release.",
      {
        status: response.status,
        tag,
        asset: assetName,
      },
    );
  const page = await response.text();
  const start = page.indexOf(assetName);
  const match =
    start >= 0
      ? /sha256:([a-f0-9]{64})/i.exec(page.slice(start, start + 4_096))
      : undefined;
  if (!match)
    throw installationError(
      "GitHub did not publish a SHA-256 checksum for the EIM asset.",
      {
        tag,
        asset: assetName,
      },
    );
  return match[1]!.toLowerCase();
};

const escapedRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const latestReleaseFromHtml = async (
  assetName: string,
  request: typeof fetch,
): Promise<EimAsset> => {
  const latest = await request(EIM_LATEST_RELEASE_PAGE, {
    headers: { Accept: "text/html", "User-Agent": "benchpilot" },
  });
  if (!latest.ok)
    throw installationError(
      "Unable to retrieve the latest EIM release from GitHub.",
      {
        status: latest.status,
      },
    );
  const tag = latest.url.split("/").at(-1);
  if (!tag || tag === "latest")
    throw installationError("GitHub did not redirect to a stable EIM release.");
  const assets = await request(
    `${EIM_RELEASE_PAGE}/${encodeURIComponent(tag)}`,
    {
      headers: { Accept: "text/html", "User-Agent": "benchpilot" },
    },
  );
  if (!assets.ok)
    throw installationError(
      "GitHub did not provide the latest EIM release assets.",
      {
        status: assets.status,
        tag,
      },
    );
  const page = await assets.text();
  const start = page.indexOf(assetName);
  const region =
    start >= 0 ? page.slice(Math.max(0, start - 2_048), start + 4_096) : "";
  const href = new RegExp(
    `href="([^"]*${escapedRegExp(assetName)})"`,
    "i",
  ).exec(region)?.[1];
  const digest = /sha256:([a-f0-9]{64})/i.exec(region)?.[1];
  if (!href || !digest)
    throw installationError(
      "GitHub did not publish a downloadable checksum-protected EIM asset.",
      {
        tag,
        asset: assetName,
      },
    );
  return {
    tag,
    asset: {
      name: assetName,
      browser_download_url: new URL(href, "https://github.com").toString(),
      digest: `sha256:${digest}`,
    },
    digest: digest.toLowerCase(),
  };
};

/** Reads GitHub's latest stable EIM release and requires a published SHA-256. */
export const resolveLatestEimAsset = async (
  input: {
    platform?: Platform;
    architecture?: NodeJS.Architecture;
    request?: typeof fetch;
  } = {},
): Promise<EimAsset> => {
  const request = input.request ?? fetch;
  const response = await request(EIM_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "benchpilot",
    },
  });
  const assetName = eimAssetName(
    input.platform ?? platformFor(),
    input.architecture,
  );
  if (!response.ok) return latestReleaseFromHtml(assetName, request);
  const release = (await response.json()) as GithubRelease;
  if (!release.tag_name || release.draft || release.prerelease)
    throw installationError("GitHub did not return a stable EIM release.");
  const asset = release.assets.find(
    (candidate) => candidate.name === assetName,
  );
  if (!asset)
    throw installationError(
      "The latest EIM release has no asset for this platform.",
      {
        tag: release.tag_name,
        asset: assetName,
      },
    );
  const declared = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
  return {
    tag: release.tag_name,
    asset,
    digest: declared
      ? declared.toLowerCase()
      : await digestFromAssetPage(release.tag_name, asset.name, request),
  };
};

const sha256File = async (file: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

const downloadVerified = async (input: {
  asset: EimAsset;
  directory: string;
  request: typeof fetch;
  logger: { debug(message: string): void };
}) => {
  await fs.mkdir(input.directory, { recursive: true });
  const destination = path.join(input.directory, input.asset.asset.name);
  try {
    if ((await sha256File(destination)) === input.asset.digest) {
      input.logger.debug(
        `Using verified EIM asset already present: ${destination}`,
      );
      return destination;
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await input.request(input.asset.asset.browser_download_url, {
    headers: { "User-Agent": "benchpilot" },
  });
  if (!response.ok || !response.body)
    throw installationError("Unable to download the EIM release asset.", {
      status: response.status,
      asset: input.asset.asset.name,
    });
  const temporary = `${destination}.${process.pid}.${Date.now()}.download`;
  const file = await fs.open(temporary, "w");
  const hash = createHash("sha256");
  try {
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      const data = Buffer.from(chunk);
      hash.update(data);
      await file.write(data);
    }
  } finally {
    await file.close();
  }
  const actual = hash.digest("hex");
  if (actual !== input.asset.digest) {
    await fs.rm(temporary, { force: true });
    throw installationError(
      "The downloaded EIM asset failed SHA-256 verification.",
      {
        asset: input.asset.asset.name,
        expected: input.asset.digest,
        actual,
      },
    );
  }
  await fs.rm(destination, { force: true });
  await fs.rename(temporary, destination);
  await fs.writeFile(
    path.join(input.directory, "release.json"),
    `${JSON.stringify(
      {
        tag: input.asset.tag,
        asset: input.asset.asset.name,
        url: input.asset.asset.browser_download_url,
        sha256: input.asset.digest,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return destination;
};

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesUnder(candidate)
        : entry.isFile()
          ? [candidate]
          : [];
    }),
  );
  return files.flat();
};

const prepareEimExecutable = async (input: {
  root: string;
  platform: Platform;
  request: typeof fetch;
  logger: {
    debug(message: string): void;
    event(type: string, data?: Json): void;
  };
}) => {
  const asset = await resolveLatestEimAsset({
    platform: input.platform,
    request: input.request,
  });
  input.logger.event("adapter.install.eim.release", {
    tag: asset.tag,
    asset: asset.asset.name,
    url: asset.asset.browser_download_url,
    sha256: asset.digest,
  });
  const eimRoot = path.join(input.root, "eim");
  const downloaded = await downloadVerified({
    asset,
    directory: eimRoot,
    request: input.request,
    logger: input.logger,
  });
  if (input.platform === "windows") return downloaded;
  const extractRoot = path.join(eimRoot, `release-${asset.tag}`);
  await fs.mkdir(extractRoot, { recursive: true });
  const unzip = await runProcess({
    command: "unzip",
    args: ["-o", downloaded, "-d", extractRoot],
    signal: new AbortController().signal,
    captureOutput: true,
  });
  if (unzip.code !== 0)
    throw installationError("Unable to extract the verified EIM archive.", {
      code: unzip.code,
      stderr: unzip.stderr,
    });
  const executable = (await filesUnder(extractRoot)).find((candidate) =>
    /^eim(?:-cli)?(?:-[\w-]+)?$/i.test(path.basename(candidate)),
  );
  if (!executable)
    throw installationError(
      "The verified EIM archive did not contain an executable.",
    );
  await fs.chmod(executable, 0o755);
  return executable;
};

const emitPhase = (
  reporter: OperationReporter,
  key: string,
  fallback: string,
  state: "running" | "completed" = "running",
) =>
  reporter.emit("adapter.install.phase", { state, label: { key, fallback } });

const phaseForLine = (line: string) => {
  if (/Python installed successfully/i.test(line))
    return ["install.python", "Preparing Python"] as const;
  if (/Cloning ESP-IDF/i.test(line))
    return ["install.framework", "Downloading ESP-IDF"] as const;
  if (/submodule/i.test(line))
    return ["install.submodules", "Initializing ESP-IDF submodules"] as const;
  if (
    /Filtered to \d+ tools|Tool '.+' is not installed|Successfully extracted/i.test(
      line,
    )
  )
    return ["install.tools", "Installing ESP-IDF tools"] as const;
  if (
    /Creating Python virtual environment|Python environment installed successfully/i.test(
      line,
    )
  )
    return [
      "install.environment",
      "Creating the ESP-IDF Python environment",
    ] as const;
  if (/activation|PowerShell profile/i.test(line))
    return ["install.activation", "Generating activation scripts"] as const;
  if (/Component Registry/i.test(line))
    return ["install.registry", "Synchronizing component registry"] as const;
  if (/Successfully installed IDF/i.test(line))
    return ["install.finalizing", "Finalizing ESP-IDF installation"] as const;
  return undefined;
};

const captureEnvironment = async (
  activationScript: string,
  platform: Platform,
) => {
  const controller = new AbortController();
  const result =
    platform === "windows"
      ? await runProcess({
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            activationScript,
            "-e",
          ],
          signal: controller.signal,
          captureOutput: true,
        })
      : await runProcess({
          command: "sh",
          args: ["-c", '. "$1"; env -0', "benchpilot-eim", activationScript],
          signal: controller.signal,
          captureOutput: true,
        });
  if (result.code !== 0)
    throw installationError("ESP-IDF activation environment capture failed.", {
      code: result.code,
      stderr: result.stderr,
    });
  const environment: NodeJS.ProcessEnv = {};
  for (const entry of (result.stdout ?? "").split(
    platform === "windows" ? /\r?\n/ : "\0",
  )) {
    const separator = entry.indexOf("=");
    if (separator > 0)
      environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  if (!environment.IDF_PATH || !environment.IDF_PYTHON_ENV_PATH)
    throw installationError(
      "ESP-IDF activation did not provide its required environment.",
    );
  return environment;
};

const readVerifiedState = async (root: string) => {
  const statePath = path.join(root, "state", "eim_idf.json");
  let state: EimState;
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8")) as EimState;
  } catch (error) {
    throw installationError(
      "EIM did not create a valid installation state file.",
      {
        statePath,
        message: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const selected =
    state.idfInstalled?.find((item) => item.id === state.idfSelectedId) ??
    state.idfInstalled?.find((item) => item.name === ESP_IDF_VERSION);
  const idfPath = string(selected?.path);
  const pythonPath = string(selected?.python);
  const activationScript = string(selected?.activationScript);
  if (!idfPath || !pythonPath || !activationScript)
    throw installationError(
      "EIM installation state is missing ESP-IDF runtime paths.",
      { statePath },
    );
  await Promise.all(
    [idfPath, pythonPath, activationScript].map(async (candidate) => {
      try {
        await fs.access(candidate);
      } catch {
        throw installationError(
          "EIM installation state references a missing runtime path.",
          {
            path: candidate,
          },
        );
      }
    }),
  );
  return {
    statePath,
    selected: selected!,
    idfPath,
    pythonPath,
    activationScript,
  };
};

const verifyGit = async () => {
  const result = await runProcess({
    command: "git",
    args: ["--version"],
    signal: new AbortController().signal,
    captureOutput: true,
  });
  if (result.code !== 0)
    throw installationError(
      "Git is required by the official ESP-IDF installer. Install Git and retry.",
    );
};

const splitWindowsPath = (value: string) =>
  value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

const readWindowsUserPath = async () => {
  const result = await runProcess({
    command: "reg",
    args: ["query", "HKCU\\Environment", "/v", "Path"],
    signal: new AbortController().signal,
    captureOutput: true,
  });
  if (result.code !== 0) return [];
  const value = /^\s*Path\s+REG_\w+\s+(.+)$/im.exec(result.stdout ?? "")?.[1];
  return value ? splitWindowsPath(value) : [];
};

const desktopShortcuts = async (home: string) => {
  const desktop = path.join(home, "Desktop");
  try {
    return new Set(
      (await fs.readdir(desktop)).filter((name) => /^IDF_.*\.lnk$/i.test(name)),
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Set<string>();
    throw error;
  }
};

const windowsSideEffectsBefore = async (
  home: string,
): Promise<WindowsSideEffects> => ({
  userPath: await readWindowsUserPath(),
  desktopShortcuts: await desktopShortcuts(home),
});

const pathInside = (candidate: string, root: string) => {
  const normalizedRoot = path
    .resolve(root)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
  const normalizedCandidate = path
    .resolve(candidate)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
};

const shortcutTarget = async (shortcut: string) => {
  const result = await runProcess({
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-Command",
      "$shell = New-Object -ComObject WScript.Shell; $shell.CreateShortcut($args[0]).TargetPath",
      shortcut,
    ],
    signal: new AbortController().signal,
    captureOutput: true,
  });
  return result.code === 0 ? (result.stdout ?? "").trim() : undefined;
};

const cleanupWindowsSideEffects = async (input: {
  before: WindowsSideEffects;
  home: string;
  root: string;
  logger: {
    event(type: string, data?: Json, options?: { level?: "warn" }): void;
    warn(message: string): void;
  };
}) => {
  try {
    const current = await readWindowsUserPath();
    const before = new Set(
      input.before.userPath.map((entry) => entry.toLowerCase()),
    );
    const managed = current.filter(
      (entry) =>
        !before.has(entry.toLowerCase()) && pathInside(entry, input.root),
    );
    if (managed.length) {
      const next = current
        .filter((entry) => !managed.includes(entry))
        .join(";");
      const updated = await runProcess({
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          '[Environment]::SetEnvironmentVariable("Path", $args[0], "User")',
          next,
        ],
        signal: new AbortController().signal,
        captureOutput: true,
      });
      if (updated.code !== 0)
        throw installationError(
          "Unable to remove EIM-managed entries from the Windows user PATH.",
          { code: updated.code, stderr: updated.stderr },
        );
      input.logger.event("adapter.install.side-effects.path-cleaned", {
        entries: managed,
      });
    }
    const afterShortcuts = await desktopShortcuts(input.home);
    const created = [...afterShortcuts].filter(
      (name) => !input.before.desktopShortcuts.has(name),
    );
    const removed: string[] = [];
    for (const name of created) {
      const shortcut = path.join(input.home, "Desktop", name);
      const target = await shortcutTarget(shortcut);
      if (!target || !pathInside(target, input.root)) continue;
      await fs.rm(shortcut, { force: true });
      removed.push(name);
    }
    if (removed.length)
      input.logger.event("adapter.install.side-effects.shortcuts-cleaned", {
        shortcuts: removed,
      });
  } catch (error) {
    input.logger.warn(
      `Could not fully clean up an EIM Windows side effect: ${error instanceof Error ? error.message : String(error)}`,
    );
    input.logger.event(
      "adapter.install.side-effects.cleanup-failed",
      { message: error instanceof Error ? error.message : String(error) },
      { level: "warn" },
    );
  }
};

const verifyRuntime = async (input: {
  idfPath: string;
  pythonPath: string;
  activationScript: string;
  platform: Platform;
}) => {
  const environment = await captureEnvironment(
    input.activationScript,
    input.platform,
  );
  const probes = [
    { command: input.pythonPath, args: ["--version"] },
    {
      command: input.pythonPath,
      args: [path.join(input.idfPath, "tools", "idf.py"), "--version"],
    },
    { command: input.pythonPath, args: ["-m", "esptool", "version"] },
    { command: "cmake", args: ["--version"] },
    { command: "ninja", args: ["--version"] },
  ];
  for (const probe of probes) {
    const result = await runProcess({
      ...probe,
      env: { ...process.env, ...environment },
      signal: new AbortController().signal,
      captureOutput: true,
    });
    if (result.code !== 0)
      throw installationError("An installed ESP-IDF runtime probe failed.", {
        command: probe.command,
        args: probe.args,
        code: result.code,
        stderr: result.stderr,
      });
  }
};

/** Explicit first-party EIM installer layered on the declarative ESP-IDF adapter. */
export const espIdfInstallation = (): AdapterInstallation => ({
  platforms: ["windows", "linux", "macos"],
  stability: process.platform === "win32" ? "stable" : "experimental",
  estimate: installEstimate,
  fields: [
    {
      key: "target",
      summary:
        "Chip target to install (a single target avoids downloading every toolchain).",
      required: true,
      choices: [
        { value: "esp32", label: "ESP32" },
        { value: "esp32s2", label: "ESP32-S2" },
        { value: "esp32s3", label: "ESP32-S3" },
        { value: "esp32c2", label: "ESP32-C2" },
        { value: "esp32c3", label: "ESP32-C3" },
        { value: "esp32c5", label: "ESP32-C5" },
        { value: "esp32c6", label: "ESP32-C6" },
        { value: "esp32h2", label: "ESP32-H2" },
        { value: "esp32p4", label: "ESP32-P4" },
      ],
    },
  ],
  async install(context) {
    const platform = platformFor();
    const target = string(context.values.target);
    if (!target)
      throw installationError("ESP-IDF installation requires a chip target.");
    const report = (
      key: string,
      fallback: string,
      state?: "running" | "completed",
    ) => emitPhase(context.reporter, key, fallback, state);
    report("install.prerequisites", "Checking installation prerequisites");
    context.logger.info(
      `Installing ESP-IDF ${ESP_IDF_VERSION} for ${target} at ${context.root}.`,
    );
    await verifyGit();
    report(
      "install.prerequisites",
      "Checking installation prerequisites",
      "completed",
    );
    report(
      "install.eim",
      "Retrieving the latest Espressif Installation Manager",
    );
    const executable = await prepareEimExecutable({
      root: context.root,
      platform,
      request: fetch,
      logger: context.logger,
    });
    report(
      "install.eim",
      "Retrieving the latest Espressif Installation Manager",
      "completed",
    );
    await fs.mkdir(path.join(context.root, "logs"), { recursive: true });
    const sideEffects =
      platform === "windows"
        ? await windowsSideEffectsBefore(context.paths.home)
        : undefined;
    report("install.framework", "Installing ESP-IDF");
    let buffered = "";
    const onOutput = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        context.logger.debug(`EIM: ${line}`);
        const phase = phaseForLine(line);
        if (phase) report(phase[0], phase[1]);
      }
    };
    let result: Awaited<ReturnType<typeof runProcess>>;
    try {
      result = await runProcess({
        command: executable,
        args: [
          "install",
          "--path",
          path.join(context.root, "frameworks"),
          "--idf-versions",
          ESP_IDF_VERSION,
          "--target",
          target,
          "--non-interactive",
          "true",
          "--install-all-prerequisites",
          "true",
          "--tool-download-folder-name",
          path.join(context.root, "dist"),
          "--tool-install-folder-name",
          path.join(context.root, "tools"),
          "--python-env-folder-name",
          "python",
          "--esp-idf-json-path",
          path.join(context.root, "state"),
          "--activation-script-path-override",
          path.join(context.root, "activation"),
          "--config-file-save-path",
          path.join(context.root, "state", "install-config.toml"),
          "--create-bat-activation-script",
          "true",
          "--cleanup",
          "false",
          "--log-file",
          path.join(context.root, "logs", "eim.log"),
        ],
        signal: new AbortController().signal,
        captureOutput: true,
        maxCaptureBytes: 4 * 1024 * 1024,
        onStdout: onOutput,
        onStderr: onOutput,
      });
    } finally {
      if (sideEffects)
        await cleanupWindowsSideEffects({
          before: sideEffects,
          home: context.paths.home,
          root: context.root,
          logger: context.logger,
        });
    }
    if (buffered) context.logger.debug(`EIM: ${buffered}`);
    if (result.code !== 0)
      throw installationError(
        "The official ESP-IDF installer did not complete successfully.",
        {
          code: result.code,
          signal: result.signal,
          stderr: result.stderr,
        },
      );
    report("install.framework", "Installing ESP-IDF", "completed");
    report(
      "install.verification",
      "Verifying the installed ESP-IDF environment",
    );
    const verified = await readVerifiedState(context.root);
    await verifyRuntime({ ...verified, platform });
    report(
      "install.verification",
      "Verifying the installed ESP-IDF environment",
      "completed",
    );
    const exportScript = verified.activationScript;
    const exportBatScript =
      platform === "windows" && /\.bat$/i.test(verified.activationScript)
        ? verified.activationScript
        : undefined;
    return {
      release: ESP_IDF_VERSION,
      root: context.root,
      statePath: verified.statePath,
      configuration: {
        managed_root: context.root,
        installation_source: "eim",
        idf_path: verified.idfPath,
        idf_py_path: path.join(verified.idfPath, "tools", "idf.py"),
        python_path: verified.pythonPath,
        export_script: exportScript,
        ...(exportBatScript ? { export_bat_script: exportBatScript } : {}),
        target,
      },
    };
  },
});
