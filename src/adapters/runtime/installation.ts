import type { AdapterInstallation, Json } from "../../core.js";
import {
  createEimInstallation,
  type EimInstallationDefinition,
} from "./eim-installer.js";
import { object } from "./rules/template.js";

const platformNames = ["windows", "linux", "macos"] as const;
type Platform = (typeof platformNames)[number];

/** A runtime-owned implementation selected by a compiled installation declaration. */
export interface InstallationProvider {
  readonly id: string;
  create(definition: Json): AdapterInstallation | undefined;
}

/**
 * Provider dispatch is explicit and independent of Adapter IDs. New installer
 * integrations register one provider rather than adding adapter-specific
 * branching to the declarative runtime.
 */
export class InstallationProviderRegistry {
  private readonly providers = new Map<string, InstallationProvider>();

  constructor(providers: Iterable<InstallationProvider> = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: InstallationProvider) {
    if (!/^[a-z][a-z0-9-]*$/.test(provider.id))
      throw new TypeError(
        `Installation provider ID is invalid: ${provider.id}`,
      );
    if (this.providers.has(provider.id))
      throw new TypeError(
        `Installation provider already registered: ${provider.id}`,
      );
    this.providers.set(provider.id, provider);
  }

  create(definition: Json): AdapterInstallation | undefined {
    const provider = object(definition).provider;
    return typeof provider === "string"
      ? this.providers.get(provider)?.create(definition)
      : undefined;
  }
}

const eimProvider: InstallationProvider = {
  id: "eim",
  create(definition) {
    const value = object(definition);
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
          typeof estimate.minimum_bytes === "number"
            ? estimate.minimum_bytes
            : 0,
        maximumBytes:
          typeof estimate.maximum_bytes === "number"
            ? estimate.maximum_bytes
            : 0,
      },
      fields,
      targetField,
      allowedTargets: selectedField.choices.map((choice) => choice.value),
      configuration,
    });
  },
};

/** The providers built into this runtime release. */
export const builtinInstallationProviders = new InstallationProviderRegistry([
  eimProvider,
]);

/** Builds an installer from a compiled bundle declaration through registered providers. */
export const installationFor = (
  definition: Json,
  providers = builtinInstallationProviders,
): AdapterInstallation | undefined => providers.create(definition);
