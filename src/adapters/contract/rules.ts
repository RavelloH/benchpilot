/** Pure parser and value-casting rules shared by compiler conformance and runtime. */
export type RuleObject = Record<string, unknown>;

export const object = (value: unknown): RuleObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RuleObject)
    : {};

export type CastKind = "string" | "integer" | "number" | "boolean" | "json";

export const castValue = (value: unknown, kind: CastKind): unknown => {
  if (kind === "string") return String(value);
  if (kind === "integer") {
    if (typeof value === "number")
      return Number.isFinite(value) ? Math.trunc(value) : undefined;
    if (typeof value !== "string" || !/^[+-]?\d+$/.test(value))
      return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }
  if (kind === "json") {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const sourceText = (source: unknown, stdout: string, stderr: string) =>
  source === "stderr"
    ? stderr
    : source === "both"
      ? `${stdout}\n${stderr}`
      : stdout;

const pointer = (value: unknown, path: string) =>
  path
    .slice(1)
    .split("/")
    .reduce<unknown>((current, part) => {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      if (Array.isArray(current))
        return /^(0|[1-9][0-9]*)$/.test(key) ? current[Number(key)] : undefined;
      return object(current)[key];
    }, value);

export interface ParserResult {
  result: RuleObject;
  progress: Array<{ event: unknown; data: RuleObject }>;
  error?: RuleObject;
  requiredMissing: string[];
  success: boolean;
}

export const parseOutput = (
  parser: RuleObject,
  stdout: string,
  stderr: string,
  exitCode: unknown,
): ParserResult => {
  const normalized = (value: string) =>
    parser.strip_ansi ? value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "") : value;
  const output = normalized(stdout);
  const errorOutput = normalized(stderr);
  const error = (Array.isArray(parser.errors) ? parser.errors : [])
    .map((rule, index) => ({ rule: object(rule), index }))
    .sort(
      (left, right) =>
        Number(right.rule.priority ?? 0) - Number(left.rule.priority ?? 0) ||
        left.index - right.index,
    )
    .map(({ rule }) => rule)
    .find((rule) => {
      try {
        return new RegExp(String(rule.pattern)).test(
          sourceText(rule.source, output, errorOutput),
        );
      } catch {
        return false;
      }
    });
  const result: RuleObject = {};
  const requiredMissing: string[] = [];
  for (const rawRule of Array.isArray(parser.extract) ? parser.extract : []) {
    const rule = object(rawRule);
    let extracted: unknown;
    try {
      if (rule.type === "json-pointer")
        extracted = pointer(
          JSON.parse(sourceText(rule.source, output, errorOutput)),
          String(rule.pointer),
        );
      else {
        const match = new RegExp(String(rule.pattern)).exec(
          sourceText(rule.source, output, errorOutput),
        );
        extracted =
          match?.groups?.[String(rule.group)] ?? match?.[Number(rule.group)];
      }
      if (extracted !== undefined)
        extracted = castValue(extracted, rule.cast as CastKind);
    } catch {
      extracted = undefined;
    }
    if (extracted === undefined && rule.required)
      requiredMissing.push(String(rule.id));
    if (extracted !== undefined) result[String(rule.target)] = extracted;
  }
  const progress = (
    Array.isArray(parser.progress) ? parser.progress : []
  ).flatMap((rawRule) => {
    const rule = object(rawRule);
    try {
      return Array.from(
        sourceText(rule.source, output, errorOutput).matchAll(
          new RegExp(String(rule.pattern), "g"),
        ),
        (match) => ({
          event: rule.event,
          data: Object.fromEntries(
            Object.entries(object(rule.fields)).map(([name, kind]) => [
              name,
              castValue(match.groups?.[name] ?? "", kind as CastKind),
            ]),
          ),
        }),
      );
    } catch {
      return [];
    }
  });
  return {
    result,
    progress,
    error,
    requiredMissing,
    success:
      !error &&
      !requiredMissing.length &&
      (parser.success_exit_codes as unknown[] | undefined)?.includes(
        exitCode,
      ) === true,
  };
};
