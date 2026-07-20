import type { HelpViewDefinition } from "./types.js";

export const helpViewDefinitions: readonly HelpViewDefinition[] = [
  {
    id: "root-help",
    blocks: [
      { component: "Brand", asset: "benchpilot-wordmark" },
      { component: "Text", source: "summary", tone: "muted" },
      { component: "UsageList" },
      { component: "CommandCollection", widthGroup: "root-label" },
      {
        component: "FieldList",
        source: "globalOptions",
        widthGroup: "root-label",
      },
      { component: "ExampleList" },
      { component: "MessageList", source: "footer" },
    ],
  },
  {
    id: "command-help",
    blocks: [
      { component: "Text", source: "summary", tone: "heading" },
      { component: "Description" },
      { component: "UsageList" },
      { component: "ChildList", widthGroup: "help-label" },
      {
        component: "FieldList",
        source: "arguments",
        widthGroup: "help-label",
      },
      {
        component: "FieldList",
        source: "options",
        widthGroup: "help-label",
      },
      {
        component: "FieldList",
        source: "globalOptions",
        widthGroup: "help-label",
      },
      { component: "SafetyDetail" },
      { component: "OutputDetail" },
      { component: "ErrorList" },
      { component: "ExampleList" },
    ],
  },
  {
    id: "all-help",
    blocks: [
      { component: "Text", source: "summary", tone: "heading" },
      { component: "UsageList" },
      { component: "ChildList", widthGroup: "help-label" },
      {
        component: "FieldList",
        source: "globalOptions",
        widthGroup: "help-label",
      },
      { component: "ExampleList" },
      { component: "MessageList", source: "footer" },
    ],
  },
];
