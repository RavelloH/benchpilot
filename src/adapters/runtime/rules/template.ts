export type RuleObject = Record<string, unknown>;

export const object = (value: unknown): RuleObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RuleObject)
    : {};

export const lookup = (context: RuleObject, path: string) =>
  path
    .split(".")
    .reduce<unknown>((value, part) => object(value)[part], context);

export const renderTemplate = (
  value: unknown,
  context: RuleObject,
): unknown => {
  if (typeof value !== "string") return value;
  const exact = /^\$\{([^}]+)\}$/.exec(value);
  if (exact) return lookup(context, exact[1]);
  return value.replace(/\$\{([^}]+)\}/g, (_match, path: string) =>
    String(lookup(context, path) ?? ""),
  );
};

export const renderDeep = (value: unknown, context: RuleObject): unknown => {
  if (Array.isArray(value))
    return value.map((item) => renderDeep(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as RuleObject).map(([key, item]) => [
        key,
        renderDeep(item, context),
      ]),
    );
  return renderTemplate(value, context);
};

export const evaluateCondition = (when: unknown, context: RuleObject) => {
  if (!when) return true;
  const item = object(when);
  const actual = lookup(context, String(item.path));
  switch (item.operator) {
    case "exists":
      return actual !== undefined;
    case "not-exists":
      return actual === undefined;
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "equals":
      return actual === renderDeep(item.value, context);
    case "not-equals":
      return actual !== renderDeep(item.value, context);
    case "in":
      return (
        Array.isArray(item.value) &&
        (renderDeep(item.value, context) as unknown[]).includes(actual)
      );
    case "not-in":
      return (
        Array.isArray(item.value) &&
        !(renderDeep(item.value, context) as unknown[]).includes(actual)
      );
    default:
      return false;
  }
};
