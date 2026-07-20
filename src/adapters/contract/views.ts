/**
 * Screen-only Adapter presentation metadata. It is deliberately limited to
 * selectors and central formatter ids; Adapters never ship renderer code.
 */
export type AdapterViewFormatter =
  | "string"
  | "fallback-dash"
  | "duration-ms"
  | "byte-size"
  | "json-value"
  | "comma-list";

export interface AdapterViewMessage {
  readonly key: string;
  readonly fallback: string;
}

export interface AdapterDetailViewField {
  readonly selector: string;
  readonly label: AdapterViewMessage;
  readonly formatter: AdapterViewFormatter;
}

export interface AdapterDetailView {
  readonly kind: "detail";
  readonly title: AdapterViewMessage;
  readonly empty?: AdapterViewMessage;
  readonly fields: readonly AdapterDetailViewField[];
}

export interface AdapterTreeView {
  readonly kind: "tree";
  readonly title: AdapterViewMessage;
  readonly empty?: AdapterViewMessage;
}

export interface AdapterKeyValueTableView {
  readonly kind: "table";
  readonly title: AdapterViewMessage;
  readonly empty?: AdapterViewMessage;
  readonly keys: Readonly<Record<string, AdapterViewMessage>>;
}

export interface AdapterCompletionView {
  readonly kind: "completion";
  readonly message: AdapterViewMessage;
}

export type AdapterCapabilityView =
  | AdapterDetailView
  | AdapterTreeView
  | AdapterKeyValueTableView
  | AdapterCompletionView;

export type AdapterCapabilityViews = Readonly<
  Record<string, AdapterCapabilityView>
>;
