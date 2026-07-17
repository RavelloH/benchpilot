import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProcess } from "../../../core/process/process-runner.js";
import { sha, stable } from "../../../core/utilities/stable-json.js";
import { AdapterRuntimeError } from "../errors.js";
import {
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

/** Resolves the Environment declared by one member of a Tool launch chain. */
export const environmentFor =
  (
    resolver: EnvironmentResolver,
    environments: RuleObject,
    context: RuleObject,
    signal: AbortSignal,
  ) =>
  async (tool: { environmentId: string }): Promise<NodeJS.ProcessEnv> =>
    (
      await resolver.resolveDetailed(
        tool.environmentId,
        environments,
        context,
        signal,
      )
    ).environment;

const duration = (value: unknown, fallback = 10_000) => {
  const match = /^([1-9]\d*)(ms|s|m|h)$/.exec(String(value ?? ""));
  if (!match) return fallback;
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * (scale ?? 1);
};

const mergeEnvironment = (base: NodeJS.ProcessEnv, values: RuleObject) => {
  const output = { ...base };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string")
      throw new AdapterRuntimeError(
        "ADAPTER_ENVIRONMENT_UNAVAILABLE",
        `Environment variable ${key} must render to a string.`,
      );
    const existing =
      process.platform === "win32"
        ? Object.keys(output).find(
            (item) => item.toLowerCase() === key.toLowerCase(),
          )
        : key;
    if (existing && existing !== key) delete output[existing];
    output[key] = value;
  }
  return output;
};

const envValue = (base: NodeJS.ProcessEnv, name: string) =>
  Object.entries(base).find(([key]) =>
    process.platform === "win32"
      ? key.toLowerCase() === name.toLowerCase()
      : key === name,
  )?.[1];

interface CaptureCommand {
  command: string;
  args: string[];
  sentinel: string;
  cleanup?: () => Promise<void>;
}

const captureCommand = async (
  shell: unknown,
  script: string,
): Promise<CaptureCommand> => {
  const sentinel = "__BENCHPILOT_ENV__";
  const emit =
    "process.stdout.write('__BENCHPILOT_ENV__'+JSON.stringify(process.env))";
  if (shell === "powershell") {
    const directory = await mkdtemp(path.join(tmpdir(), "benchpilot-env-"));
    const wrapper = path.join(directory, "capture.ps1");
    await writeFile(
      wrapper,
      [
        "param([string]$ScriptPath, [string]$NodePath, [string]$EmitProgram)",
        ". $ScriptPath",
        "& $NodePath -e $EmitProgram",
        "exit $LASTEXITCODE",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        wrapper,
        script,
        process.execPath,
        emit,
      ],
      sentinel,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }
  if (shell === "cmd") {
    const directory = await mkdtemp(path.join(tmpdir(), "benchpilot-env-"));
    const wrapper = path.join(directory, "capture.cmd");
    await writeFile(
      wrapper,
      [
        "@echo off",
        "setlocal DisableDelayedExpansion",
        'call "%~1"',
        "if errorlevel 1 exit /b %errorlevel%",
        '"%~2" -e "%~3"',
        "exit /b %errorlevel%",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", wrapper, script, process.execPath, emit],
      sentinel,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }
  return {
    command: "sh",
    args: [
      "-c",
      `. "$1"; "$2" -e "$3"`,
      "benchpilot-capture",
      script,
      process.execPath,
      emit,
    ],
    sentinel,
  };
};

export class EnvironmentResolver {
  private cache = new Map<string, NodeJS.ProcessEnv>();

  constructor(private readonly base: NodeJS.ProcessEnv = process.env) {}

  async resolve(
    id: string,
    definitions: RuleObject,
    context: RuleObject,
    signal: AbortSignal,
  ): Promise<NodeJS.ProcessEnv> {
    return (await this.resolveDetailed(id, definitions, context, signal))
      .environment;
  }

  async resolveDetailed(
    id: string,
    definitions: RuleObject,
    context: RuleObject,
    signal: AbortSignal,
  ): Promise<{
    environment: NodeJS.ProcessEnv;
    providerId: string;
    strategy: string;
    source: string;
  }> {
    if (id === "inherit")
      return {
        environment: { ...this.base },
        providerId: "inherit",
        strategy: "inherit",
        source: "process",
      };
    const definition = object(definitions[id]);
    if (!Object.keys(definition).length)
      throw new AdapterRuntimeError(
        "ADAPTER_ENVIRONMENT_UNAVAILABLE",
        `Environment does not exist: ${id}`,
      );
    if (definition.strategy === "inherit")
      return {
        environment: { ...this.base },
        providerId: "inherit",
        strategy: "inherit",
        source: "process",
      };
    const providers = (
      Array.isArray(definition.providers) ? definition.providers : []
    )
      .map((provider, index) => ({ provider: object(provider), index }))
      .sort(
        (left, right) =>
          Number(right.provider.priority ?? 0) -
            Number(left.provider.priority ?? 0) || left.index - right.index,
      );
    for (const { provider } of providers) {
      try {
        const resolved = await this.resolveProvider(provider, context, signal);
        if (resolved)
          return {
            environment: resolved,
            providerId: String(provider.id),
            strategy: String(definition.strategy),
            source: String(provider.type),
          };
      } catch (error) {
        if (error instanceof AdapterRuntimeError) continue;
        throw error;
      }
    }
    throw new AdapterRuntimeError(
      "ADAPTER_ENVIRONMENT_UNAVAILABLE",
      `No provider could resolve environment ${id}.`,
    );
  }

  private async resolveProvider(
    provider: RuleObject,
    context: RuleObject,
    signal: AbortSignal,
  ) {
    if (provider.type === "active") {
      const required = Array.isArray(provider.required_variables)
        ? provider.required_variables
        : [];
      return required.every(
        (name) =>
          typeof envValue(this.base, String(name)) === "string" &&
          envValue(this.base, String(name)),
      )
        ? { ...this.base }
        : undefined;
    }
    if (provider.type === "static") {
      const variables = Object.fromEntries(
        Object.entries(object(provider.variables)).map(([key, value]) => [
          key,
          renderRequiredTemplate(value, context, "environment"),
        ]),
      );
      return mergeEnvironment(this.base, variables);
    }
    if (provider.type !== "capture-script") return undefined;
    const rendered = renderRequiredTemplate(
      provider.script,
      context,
      "capture script",
    );
    if (typeof rendered !== "string" || !rendered)
      throw new AdapterRuntimeError(
        "ADAPTER_ENVIRONMENT_UNAVAILABLE",
        "Capture-script path is missing.",
      );
    const script = await realpath(path.resolve(rendered)).catch(
      () => undefined,
    );
    const metadata = script
      ? await stat(script).catch(() => undefined)
      : undefined;
    if (!script || !metadata?.isFile())
      throw new AdapterRuntimeError(
        "ADAPTER_ENVIRONMENT_UNAVAILABLE",
        "Capture-script path is invalid.",
      );
    const key = sha(
      stable({
        adapterId: object(context.adapter).id,
        platform: process.platform,
        providerId: provider.id,
        script,
        mtimeMs: metadata.mtimeMs,
        environment: Object.keys(this.base)
          .sort()
          .map((name) => [name, this.base[name]]),
      }),
    );
    const cached = this.cache.get(key);
    if (cached) return { ...cached };
    const command = await captureCommand(provider.shell, script);
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort({ kind: "environment-capture-timeout" });
      },
      Math.min(10_000, duration(provider.timeout, 10_000)),
    );
    try {
      const result = await runProcess({
        command: command.command,
        args: command.args,
        env: { ...this.base },
        signal: controller.signal,
        captureOutput: true,
        maxCaptureBytes: 1_048_576,
      });
      const serialized = result.stdout?.split(command.sentinel).at(-1);
      if (result.code !== 0 || !serialized)
        throw new AdapterRuntimeError(
          "ADAPTER_ENVIRONMENT_UNAVAILABLE",
          "Capture-script execution failed.",
        );
      let environment: NodeJS.ProcessEnv;
      try {
        environment = JSON.parse(serialized) as NodeJS.ProcessEnv;
      } catch {
        throw new AdapterRuntimeError(
          "ADAPTER_ENVIRONMENT_UNAVAILABLE",
          "Capture-script did not emit a valid environment.",
        );
      }
      this.cache.set(key, environment);
      return { ...environment };
    } catch (error) {
      // Keep a parent operation/action abort intact. The internal hard limit
      // is intentionally reported as an environment failure instead.
      if (timedOut && !signal.aborted)
        throw new AdapterRuntimeError(
          "ADAPTER_ENVIRONMENT_UNAVAILABLE",
          "Environment capture script timed out.",
          true,
          [
            "Check the SDK activation script.",
            "Run the script manually to verify it exits.",
          ],
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      await command.cleanup?.();
    }
  }
}
