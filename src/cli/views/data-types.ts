import type { MessageRef } from "../../contracts/message-ref.js";
import type { JsonValue } from "../../contracts/index.js";
import type { ScreenRenderContext } from "../output/engine.js";

export type CellTone =
  | "plain"
  | "heading"
  | "muted"
  | "command"
  | "argument"
  | "success"
  | "warning"
  | "error"
  | "debug";

export type DataFormatterId =
  | "string"
  | "fallback-dash"
  | "fallback-unknown"
  | "enabled-adapters"
  | "duration-ms"
  | "byte-size"
  | "approval-status"
  | "lock-liveness"
  | "lock-state"
  | "lock-resource"
  | "comma-list"
  | "upgrade-status"
  | "upgrade-version"
  | "json-value"
  | "origin"
  | "resource-summary"
  | "run-status"
  | "scope"
  | "role"
  | "system-result"
  | "doctor-status"
  | "capability-status"
  | "diagnostic-level"
  | "diagnostic-message"
  | "approval-command"
  | "approval-project"
  | "json-value-optional"
  | "valid-status";

export interface TableColumnDefinition {
  readonly field: string;
  readonly header?: MessageRef;
  readonly formatter: DataFormatterId;
  readonly tone?: CellTone;
  readonly paddingTone?: "inside" | "outside";
  readonly width?:
    | { readonly kind: "content"; readonly min: number; readonly gap: number }
    | {
        readonly kind: "fixed";
        readonly size: number;
        readonly minimum: number;
      };
}

export interface TableBlockDefinition {
  readonly component: "Table";
  readonly source: string;
  readonly title: MessageRef;
  readonly empty?: MessageRef;
  readonly header?: boolean;
  readonly headerWhenEmpty?: boolean;
  readonly lineBreakAfter?: boolean;
  readonly omitWhenEmpty?: boolean;
  readonly columns: readonly TableColumnDefinition[];
}

export interface DetailRowDefinition {
  readonly field: string;
  readonly label: MessageRef;
  readonly formatter: DataFormatterId;
  readonly tone?: CellTone;
  readonly omitEmpty?: boolean;
}

export interface DetailBlockDefinition {
  readonly component: "Detail";
  readonly source: string;
  readonly title: MessageRef;
  readonly empty?: MessageRef;
  readonly labelWidth: number;
  readonly omitWhenEmpty?: boolean;
  readonly rows: readonly DetailRowDefinition[];
}

export interface MessageBlockDefinition {
  readonly component: "Message";
  readonly field: string;
  readonly messages: Readonly<Record<string, MessageRef>>;
  readonly tone: CellTone;
}

export interface StaticMessageBlockDefinition {
  readonly component: "StaticMessage";
  readonly message: MessageRef;
  readonly tone: CellTone;
}

export interface ListBlockDefinition {
  readonly component: "List";
  readonly source: string;
  readonly title: MessageRef;
  readonly empty: MessageRef;
  readonly formatter: DataFormatterId;
  readonly tone?: CellTone;
  readonly limit?: number;
  readonly overflow?: {
    readonly message: MessageRef;
    readonly tone: CellTone;
  };
}

export interface LogBlockDefinition {
  readonly component: "Log";
  readonly source: string;
}

export interface ObjectTreeBlockDefinition {
  readonly component: "ObjectTree";
  readonly source: string;
  readonly metadataSource?: string;
  readonly title: MessageRef;
  readonly empty: MessageRef;
  readonly labelWidth: number;
  readonly rows: readonly DetailRowDefinition[];
}

export interface KeyValueTableBlockDefinition {
  readonly component: "KeyValueTable";
  readonly source: string;
  readonly title: MessageRef;
  readonly empty: MessageRef;
  readonly keyLabels: Readonly<Record<string, MessageRef>>;
  readonly includeName?: boolean;
  readonly keyWidthFrom?: {
    readonly source: string;
    readonly field: string;
    readonly min: number;
    readonly gap: number;
  };
}

export interface GroupedTableBlockDefinition {
  readonly component: "GroupedTable";
  readonly source: string;
  readonly groupBy: string;
  readonly defaultTitle: MessageRef;
  readonly groupTitle: MessageRef;
  readonly groupValueName: string;
  readonly header: boolean;
  readonly headerWhenEmpty?: boolean;
  readonly columns: readonly TableColumnDefinition[];
}

export type DataViewBlockDefinition =
  | TableBlockDefinition
  | DetailBlockDefinition
  | MessageBlockDefinition
  | StaticMessageBlockDefinition
  | ListBlockDefinition
  | LogBlockDefinition
  | ObjectTreeBlockDefinition
  | KeyValueTableBlockDefinition
  | GroupedTableBlockDefinition;

export interface DataViewDefinition {
  readonly id: string;
  readonly blocks: readonly DataViewBlockDefinition[];
}

export interface FormattedCell {
  readonly text: string;
  readonly tone?: CellTone;
}

export interface DataViewRenderContext extends ScreenRenderContext {
  readonly data: JsonValue;
  readonly presentation?: JsonValue;
  readonly adapter?: string;
}
