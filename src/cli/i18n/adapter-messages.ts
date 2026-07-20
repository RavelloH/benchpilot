import type { Adapter } from "../../core.js";
import type { Locale } from "../../i18n/index.js";

interface LocalizableCapability {
  readonly id: string;
  readonly summary: string;
  readonly description?: string;
}

/** Resolves Adapter-owned display text at the CLI presentation boundary. */
export const localizeAdapterCapability = <
  CapabilityType extends LocalizableCapability,
>(
  adapter: Adapter,
  locale: Locale,
  capability: CapabilityType,
): CapabilityType => ({
  ...capability,
  summary:
    adapter.translate?.(locale, `capability.${capability.id}.summary`) ??
    capability.summary,
  ...(capability.description
    ? {
        description:
          adapter.translate?.(
            locale,
            `capability.${capability.id}.description`,
          ) ?? capability.description,
      }
    : {}),
});

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
