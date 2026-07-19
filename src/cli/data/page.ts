import type { Locale } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";

export type DataScreenView = "normal" | "agent";

export interface DataScreenContext {
  readonly locale: Locale;
  readonly color: boolean;
  readonly view: DataScreenView;
}

/** One independently consumable item in a JSON Lines data stream. */
export interface CliDataJsonlItem {
  /** Stable, page-local path identifying the item within the result. */
  readonly key: string;
  readonly value: object;
}

/** Canonical command data with a screen view derived from that same DTO. */
export interface CliDataPage<T extends object> {
  readonly data: T;
  readonly screen: (context: DataScreenContext) => readonly CliScreenNode[];
  /**
   * Optional item projection for collection pages. JSON remains the complete
   * DTO; JSONL emits each item as a separate snapshot in source order.
   */
  readonly jsonl?: readonly CliDataJsonlItem[];
}
