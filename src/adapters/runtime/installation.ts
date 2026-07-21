import type { AdapterInstallation, Json } from "../../core.js";
import {
  createEimInstallation,
  type EimInstallationDefinition,
} from "./eim-installer.js";
import { object } from "./rules/template.js";

const platformNames = ["windows", "linux", "macos"] as const;
type Platform = (typeof platformNames)[number];

/** Builds an installer only from the compiled bundle declaration. */
export const installationFor = (
  definition: Json,
): AdapterInstallation | undefined => {
  const value = object(definition);
  if (value.provider !== "eim") return undefined;
  const platformRules = object(value.platforms);
  const platforms = platformNames.filter(
    (platform) => platformRules[platform] !== "unsupported",
  );
  const current =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : "linux";
  const stability =
    platformRules[current] === "stable" ? "stable" : "experimental";
  const estimate = object(value.estimate);
  const fields = Array.isArray(value.fields)
    ? value.fields.flatMap((item) => {
        const field = object(item);
        if (
          typeof field.key !== "string" ||
          typeof field.summary !== "string" ||
          typeof field.required !== "boolean"
        )
          return [];
        return [
          {
            key: field.key,
            summary: field.summary,
            required: field.required,
            ...(field.separator === "," ? { separator: "," as const } : {}),
            ...(Array.isArray(field.choices)
              ? {
                  choices: field.choices.flatMap((choice) => {
                    const item = object(choice);
                    return typeof item.value === "string" &&
                      typeof item.label === "string"
                      ? [{ value: item.value, label: item.label }]
                      : [];
                  }),
                }
              : {}),
          },
        ];
      })
    : [];
  const eim = object(value.eim);
  const targetField =
    typeof eim.target_field === "string" ? eim.target_field : "";
  const selectedField = fields.find((field) => field.key === targetField);
  if (!platforms.length || !targetField || !selectedField?.choices?.length)
    return undefined;
  const configuration = Object.fromEntries(
    Object.entries(object(eim.configuration)).flatMap(([key, source]) =>
      typeof source === "string" ? [[key, source]] : [],
    ),
  ) as EimInstallationDefinition["configuration"];
  return createEimInstallation({
    platforms,
    stability,
    estimate: {
      minimumBytes:
        typeof estimate.minimum_bytes === "number" ? estimate.minimum_bytes : 0,
      maximumBytes:
        typeof estimate.maximum_bytes === "number" ? estimate.maximum_bytes : 0,
    },
    fields,
    targetField,
    allowedTargets: selectedField.choices.map((choice) => choice.value),
    configuration,
  });
};
