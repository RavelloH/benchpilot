import { object, type RuleObject } from "./rules.js";

export type ArtifactPlan =
  | { id: unknown; path: string; required: unknown; multiple: unknown }
  | { id: unknown; glob: string; required: unknown; multiple: unknown };

const lookup = (context: RuleObject, path: string) =>
  path
    .split(".")
    .reduce<unknown>((value, part) => object(value)[part], context);

const renderTemplate = (value: unknown, context: RuleObject): unknown => {
  if (typeof value !== "string") return value;
  const exact = /^\$\{([^}]+)\}$/.exec(value);
  if (exact) return lookup(context, exact[1]);
  return value.replace(/\$\{([^}]+)\}/g, (_match, path: string) =>
    String(lookup(context, path) ?? ""),
  );
};

const unsafePath = (value: unknown) =>
  typeof value === "string" &&
  (value.split(/[\\/]/).includes("..") ||
    /^[\\/]/.test(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^(\\\\|\/\/)/.test(value));

/** Plans artifact paths without filesystem access. */
export const planArtifacts = (set: RuleObject, context: RuleObject) => {
  const base = String(renderTemplate(set.base, context) ?? "");
  const entries = Array.isArray(set.entries) ? set.entries : [];
  const plans = entries.map((entry) => {
    const value = object(entry);
    const relative = typeof value.path === "string" ? value.path : value.glob;
    const rendered = String(renderTemplate(relative, context) ?? "");
    const resolved = `${base}/${rendered}`.replace(/\\/g, "/");
    return typeof value.path === "string"
      ? {
          id: value.id,
          path: resolved,
          required: value.required,
          multiple: value.multiple,
        }
      : {
          id: value.id,
          glob: resolved,
          required: value.required,
          multiple: value.multiple,
        };
  }) as ArtifactPlan[];
  const unsafe = plans.some((plan, index) => {
    const entry = object(entries[index]);
    const relative = typeof entry.path === "string" ? entry.path : entry.glob;
    const value = "path" in plan ? plan.path : plan.glob;
    return [base, renderTemplate(relative, context), value].some(unsafePath);
  });
  return { plans, unsafe };
};
