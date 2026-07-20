/** One independently consumable item in a JSON Lines data stream. */
export interface CliDataJsonlItem {
  /** Stable, page-local path identifying the item within the result. */
  readonly key: string;
  readonly value: object;
}

/** Canonical command data with a screen view derived from that same DTO. */
export interface CliDataPage<T extends object> {
  readonly data: T;
  /** Human-only context used by pure formatters; never emitted to JSON/JSONL. */
  readonly presentation?: object;
  /**
   * Optional item projection for collection pages. JSON remains the complete
   * DTO; JSONL emits each item as a separate snapshot in source order.
   */
  readonly jsonl?: readonly CliDataJsonlItem[];
}
