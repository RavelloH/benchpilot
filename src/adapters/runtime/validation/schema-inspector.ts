import { stable } from "../../../core/utilities/stable-json.js";

type Schema = Record<string, unknown>;
const object = (value: unknown): Schema =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Schema)
    : {};

const pointer = (root: Schema, reference: string): unknown =>
  reference.startsWith("#/")
    ? reference
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (current, part) =>
            object(current)[part.replace(/~1/g, "/").replace(/~0/g, "~")],
          root,
        )
    : undefined;

const expand = (
  root: Schema,
  raw: unknown,
  seen = new Set<string>(),
): Schema[] => {
  const schema = object(raw);
  const output = [schema];
  if (typeof schema.$ref === "string" && !seen.has(schema.$ref)) {
    const target = pointer(root, schema.$ref);
    if (target)
      output.push(...expand(root, target, new Set([...seen, schema.$ref])));
  }
  for (const child of Array.isArray(schema.allOf) ? schema.allOf : [])
    output.push(...expand(root, child, seen));
  return output;
};

export interface SchemaProperty {
  name: string;
  schema: Schema;
  required: boolean;
}

/**
 * Returns stable command-line properties after resolving local refs and
 * allOf. A oneOf/anyOf property is returned only if every branch agrees.
 */
export const inspectSchemaProperties = (
  rootSchema: unknown,
  rawSchema: unknown,
): SchemaProperty[] => {
  const root = object(rootSchema);
  const schemas = expand(root, rawSchema);
  const required = new Set(
    schemas.flatMap((schema) =>
      Array.isArray(schema.required) ? schema.required.map(String) : [],
    ),
  );
  const candidates = new Map<string, Schema[]>();
  for (const schema of schemas)
    for (const [name, property] of Object.entries(object(schema.properties))) {
      const values = candidates.get(name) ?? [];
      values.push(...expand(root, property));
      candidates.set(name, values);
    }
  const branchSets = schemas.flatMap((schema) =>
    ["oneOf", "anyOf"].flatMap((key) =>
      Array.isArray(schema[key]) ? [schema[key] as unknown[]] : [],
    ),
  );
  return [...candidates.entries()].flatMap(([name, values]) => {
    for (const branches of branchSets) {
      const branchProperties = branches.map((branch) =>
        expand(root, branch).flatMap((item) => {
          const property = object(item.properties)[name];
          return property ? expand(root, property) : [];
        }),
      );
      if (!branchProperties.some((items) => items.length)) continue;
      const fingerprints = branchProperties.map((items) => stable(items));
      if (fingerprints.some((fingerprint) => fingerprint !== fingerprints[0]))
        return [];
      values.push(...branchProperties[0]!);
    }
    const schema = values.reduce<Schema>(
      (merged, value) => ({ ...merged, ...value }),
      {},
    );
    return [{ name, schema, required: required.has(name) }];
  });
};
