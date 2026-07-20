import type { Adapter } from "../../core.js";
import type { Locale } from "../../i18n/index.js";

interface LocalizableCapability {
  readonly id: string;
  readonly summary: string;
  readonly description?: string;
  readonly options?: readonly {
    readonly name: string;
    readonly summary: string;
  }[];
  readonly safety?: { readonly effects?: readonly string[] };
}

/** Resolves Adapter-owned display text at the CLI presentation boundary. */
export const localizeAdapterCapability = <
  CapabilityType extends LocalizableCapability,
>(
  adapter: Adapter,
  locale: Locale,
  capability: CapabilityType,
): CapabilityType => {
  const translate = (key: string, fallback?: string) =>
    adapter.translate?.(locale, key) ?? fallback;
  const description = translate(
    `capability.${capability.id}.description`,
    capability.description,
  );
  return {
    ...capability,
    summary:
      translate(`capability.${capability.id}.summary`, capability.summary) ??
      capability.summary,
    ...(description ? { description } : {}),
    ...(capability.options
      ? {
          options: capability.options.map((option) => ({
            ...option,
            summary:
              translate(
                `capability.${capability.id}.option.${option.name}.summary`,
                option.summary,
              ) ?? option.summary,
          })),
        }
      : {}),
    ...(capability.safety?.effects
      ? {
          safety: {
            ...capability.safety,
            effects: capability.safety.effects.map(
              (effect, index) =>
                translate(
                  `capability.${capability.id}.safety.effect`,
                  effect,
                ) ?? effect,
            ),
          },
        }
      : {}),
  } as CapabilityType;
};

export const localizeAdapterCapabilities = <
  CapabilityType extends LocalizableCapability,
>(
  adapter: Adapter,
  locale: Locale,
  capabilities: readonly CapabilityType[],
): CapabilityType[] =>
  capabilities.map((capability) =>
    localizeAdapterCapability(adapter, locale, capability),
  );
