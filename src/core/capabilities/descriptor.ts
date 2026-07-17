import type { Json } from "../config/config.js";
import type { Capability, CapabilityDescriptor } from "./types.js";

/** Converts an executable capability into metadata safe for read-only use. */
export const describeCapability = (
  capability: Capability,
): CapabilityDescriptor => ({
  id: capability.id,
  summary: capability.summary,
  ...(capability.description ? { description: capability.description } : {}),
  options: (capability.options || [])
    .filter((option) => option.hidden !== true)
    .map((option) => ({
      name: option.name,
      summary: option.summary,
      ...(option.required ? { required: true } : {}),
      ...(option.schema ? { schema: option.schema.describe() as Json } : {}),
      ...(option.aliases ? { aliases: [...option.aliases] } : {}),
      ...(option.positional === undefined
        ? {}
        : { positional: option.positional }),
      ...(option.secret ? { secret: true } : {}),
      ...(option.repeatable ? { repeatable: true } : {}),
    })),
  ...(capability.inputSchema
    ? { inputSchema: capability.inputSchema.describe() as Json }
    : {}),
  ...(capability.outputSchema
    ? { outputSchema: capability.outputSchema.describe() as Json }
    : {}),
  defaultTimeoutMs: capability.defaultTimeoutMs,
  lockMode: capability.lockMode,
  createsRun: capability.createsRun,
  safety: structuredClone(capability.safety),
  availability: "available",
});
