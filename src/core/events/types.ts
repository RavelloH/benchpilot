import type { Json } from "../../core.js";

export interface BenchPilotEvent {
  schema: "benchpilot.event";
  version: 1;
  event: { type: string; timestamp: string };
  context: Json;
  data: Json;
}

export interface BenchPilotEventWriter {
  emit(type: string, payload?: Json): void;
  completed(result: Json): void;
  failed(error: Json): void;
}
