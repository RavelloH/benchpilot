import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import {
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

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

const captureCommand = (shell: unknown, script: string) => {
  const sentinel = "__BENCHPILOT_ENV__";
  const emit =
    "process.stdout.write('__BENCHPILOT_ENV__'+JSON.stringify(process.env))";
  if (shell === "powershell")
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `& { . $args[0]; node -e \"${emit}\" }`,
        script,
      ],
      sentinel,
    };
  if (shell === "cmd")
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `call \"%~1\" && node -e \"${emit}\"`, script],
      sentinel,
    };
  return {
    command: "sh",
    args: ["-c", `. "$1"; node -e "$2"`, "benchpilot-capture", script, emit],
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
    if (id === "inherit") return { ...this.base };
    const definition = object(definitions[id]);
    if (!Object.keys(definition).length)
      throw new AdapterRuntimeError(
        "ADAPTER_ENVIRONMENT_UNAVAILABLE",
        `Environment does not exist: ${id}`,
      );
    if (definition.strategy === "inherit") return { ...this.base };
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
        if (resolved) return resolved;
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
          typeof this.base[String(name)] === "string" &&
          this.base[String(name)],
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
    const key = `${provider.id}:${script}:${metadata.mtimeMs}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached };
    const command = captureCommand(provider.shell, script);
    const result = await runProcess({
      command: command.command,
      args: command.args,
      env: { ...this.base },
      signal,
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
  }
}
