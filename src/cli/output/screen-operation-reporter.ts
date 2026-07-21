import type {
  Json,
  OperationReporter,
  OperationReportOptions,
} from "../../core.js";
import type { TerminalSurface } from "../terminal/surface.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";

export interface ScreenOperationProgressLabels {
  readonly preparing: string;
  readonly running: string;
  readonly cleaning: string;
  readonly completing: string;
}

type AdapterMessageResolver = (
  adapterId: string,
  key: string,
  fallback: string,
  values: Readonly<Record<string, string | number | boolean>>,
) => string;

type WorkflowStepStatus =
  "pending" | "running" | "completed" | "failed" | "skipped";

interface WorkflowStepState {
  readonly key: string;
  readonly label: string;
  readonly parentKey?: string;
  readonly progressTotal?: number;
  status: WorkflowStepStatus;
}

interface ProgressCycleState {
  next: number;
  activeKey?: string;
}

interface ProgressState {
  active: boolean;
  frame: number;
  label: string;
  labels?: ScreenOperationProgressLabels;
  messageResolver?: AdapterMessageResolver;
  steps: Map<string, WorkflowStepState>;
  cycles: Map<string, ProgressCycleState>;
  timer?: ReturnType<typeof setInterval>;
}

const spinnerFrames = ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"] as const;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Screen-only projection of Core operation events. */
export class ScreenOperationReporter implements OperationReporter {
  private readonly state: ProgressState;

  constructor(
    private readonly surface: TerminalSurface,
    labels?: ScreenOperationProgressLabels,
    private readonly context: Record<string, unknown> = {},
    state?: ProgressState,
    private readonly theme: Pick<
      TerminalTheme,
      "argument" | "muted" | "success" | "error"
    > = terminalTheme(false),
  ) {
    this.state = state ?? {
      active: false,
      frame: 0,
      label: labels?.preparing ?? "",
      steps: new Map(),
      cycles: new Map(),
      ...(labels ? { labels } : {}),
    };
  }

  /** Configures presentation only after the resolved project locale is known. */
  configure(
    labels: ScreenOperationProgressLabels,
    messageResolver?: AdapterMessageResolver,
  ) {
    if (this.state.active)
      throw new Error(
        "Operation progress may not be reconfigured while active.",
      );
    this.state.labels = labels;
    this.state.messageResolver = messageResolver;
    this.state.label = labels.preparing;
  }

  emit(type: string, data: Json = {}, _options?: OperationReportOptions) {
    const labels = this.state.labels;
    if (!labels) return;
    const values = object(data);
    if (
      type === "operation.failed" ||
      type === "operation.completed" ||
      type === "adapter.install.failed" ||
      type === "adapter.install.completed"
    ) {
      this.complete();
      return;
    }
    if (type === "adapter.install.started") {
      this.set(labels.preparing);
      return;
    }
    if (type === "operation.started") {
      this.set(labels.preparing);
      return;
    }
    if (type === "stage.started") {
      this.set(this.stageLabel(values));
      return;
    }
    if (type === "stage.completed") {
      this.set(labels.completing);
      return;
    }
    if (type === "cleanup.started") {
      this.set(labels.cleaning);
      return;
    }
    if (type === "cleanup.completed") {
      this.set(labels.completing);
      return;
    }
    if (type === "adapter.workflow.started") {
      this.initializeWorkflowSteps(values);
      return;
    }
    if (type.startsWith("adapter.workflow.step.")) {
      this.updateWorkflowStep(type, values);
      return;
    }
    if (this.hasPresentationLabel(values)) {
      this.updateAdapterProgressStep(type, values);
      return;
    }
    if (!this.state.active) this.set(labels.preparing);
  }

  child(context: Json): OperationReporter {
    return new ScreenOperationReporter(
      this.surface,
      undefined,
      { ...this.context, ...object(context) },
      this.state,
      this.theme,
    );
  }

  complete() {
    if (!this.state.active) return;
    this.state.active = false;
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = undefined;
    this.surface.remove("operation.progress");
  }

  private stageLabel(values: Record<string, unknown>) {
    const labels = this.state.labels!;
    const stage = typeof values.stage === "string" ? values.stage : undefined;
    const device =
      typeof this.context.device === "string" ? this.context.device : undefined;
    return [labels.running, device, stage].filter(Boolean).join(" ");
  }

  private set(label: string) {
    this.state.active = true;
    this.state.label = label;
    this.render();
    if (this.state.timer) return;
    this.state.timer = setInterval(() => {
      this.state.frame = (this.state.frame + 1) % spinnerFrames.length;
      this.render();
    }, 80);
    this.state.timer.unref();
  }

  private render() {
    const lines = [
      `${this.theme.argument(spinnerFrames[this.state.frame])} ${this.theme.muted(this.state.label)}`,
      ...this.renderWorkflowSteps(),
    ];
    this.surface.update("operation.progress", lines.join("\n"));
  }

  private renderWorkflowSteps(parentKey?: string, depth = 1): string[] {
    return [...this.state.steps.values()].flatMap((step) => {
      if (step.parentKey !== parentKey) return [];
      return [
        this.renderWorkflowStep(step, depth),
        ...this.renderWorkflowSteps(step.key, depth + 1),
      ];
    });
  }

  private updateWorkflowStep(type: string, values: Record<string, unknown>) {
    const status: WorkflowStepStatus = type.endsWith(".completed")
      ? "completed"
      : type.endsWith(".failed")
        ? "failed"
        : type.endsWith(".skipped")
          ? "skipped"
          : "running";
    this.setWorkflowStep(values, status);
  }

  private initializeWorkflowSteps(values: Record<string, unknown>) {
    const steps = Array.isArray(values.steps) ? values.steps : [];
    for (const step of steps)
      this.setWorkflowStep(
        { workflowId: values.workflowId, ...object(step) },
        "pending",
      );
  }

  private setWorkflowStep(
    values: Record<string, unknown>,
    status: WorkflowStepStatus,
  ) {
    const workflowId =
      typeof values.workflowId === "string" ? values.workflowId : "workflow";
    const stepId = typeof values.stepId === "string" ? values.stepId : "step";
    const displayId =
      typeof values.displayId === "string" ? values.displayId : stepId;
    const device =
      typeof this.context.device === "string" ? this.context.device : "";
    const key = [device, workflowId, displayId].join(":");
    const current = this.state.steps.get(key);
    if (status === "skipped" && current?.status === "completed") return;
    this.state.steps.set(key, {
      key,
      label: current?.label ?? this.workflowStepLabel(values, stepId),
      ...(current?.parentKey ? { parentKey: current.parentKey } : {}),
      status,
    });
    if (!this.state.active) this.set(this.state.labels!.preparing);
    else this.render();
  }

  private workflowStepLabel(values: Record<string, unknown>, fallback: string) {
    const message = object(values.label ?? {});
    const key = typeof message.key === "string" ? message.key : undefined;
    const defaultText =
      typeof message.fallback === "string" ? message.fallback : fallback;
    const variables = Object.fromEntries(
      Object.entries(object(message.values)).flatMap(([name, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? [[name, value]]
          : [],
      ),
    );
    const adapter =
      typeof this.context.adapter === "string"
        ? this.context.adapter
        : undefined;
    return key && adapter
      ? (this.state.messageResolver?.(adapter, key, defaultText, variables) ??
          defaultText)
      : defaultText;
  }

  private hasPresentationLabel(values: Record<string, unknown>) {
    const label = object(values.label ?? {});
    return typeof label.key === "string" && typeof label.fallback === "string";
  }

  private updateAdapterProgressStep(
    type: string,
    values: Record<string, unknown>,
  ) {
    const device =
      typeof this.context.device === "string" ? this.context.device : "";
    const parentKey = this.workflowParentKey(values, device);
    const prefix = parentKey ? `${parentKey}:progress:` : `${device}:progress:`;
    const eventState =
      typeof values.state === "string" ? values.state : undefined;
    const state: WorkflowStepStatus =
      eventState === "completed" ? "completed" : "running";
    const progressTotal =
      typeof values.total === "number" ? values.total : undefined;
    const reentrant = values.reentrant === true;
    const cycleParent = this.cycleParent(
      values,
      prefix,
      parentKey,
      reentrant,
      state,
    );
    const eventPrefix = cycleParent ? `${cycleParent}:progress:` : prefix;
    const instance =
      typeof values.instance === "string" ? `:instance:${values.instance}` : "";
    const key = `${eventPrefix}${type}${instance}`;
    const parentEvent =
      typeof values.parentEvent === "string" ? values.parentEvent : undefined;
    const nestedParentKey = parentEvent
      ? `${eventPrefix}${parentEvent}`
      : undefined;
    const current = this.state.steps.get(key);
    if (
      (!reentrant && current?.status === "completed" && state === "running") ||
      (!reentrant &&
        progressTotal !== undefined &&
        current?.progressTotal !== undefined &&
        progressTotal < current.progressTotal)
    )
      return;
    // Re-entrant adapter events are concurrent detail for the active phase
    // (for example, a tool count and the current download).  Keep them both
    // visible; a non-re-entrant phase transition closes the prior detail.
    if (!reentrant || values.transition === true)
      for (const step of this.state.steps.values())
        if (
          step.key.startsWith(eventPrefix) &&
          step.key !== key &&
          step.status === "running"
        )
          step.status = "completed";
    this.state.steps.set(key, {
      key,
      label: this.adapterProgressLabel(values, type),
      ...(nestedParentKey || cycleParent || parentKey
        ? { parentKey: nestedParentKey ?? cycleParent ?? parentKey }
        : {}),
      ...(progressTotal !== undefined
        ? { progressTotal }
        : current?.progressTotal !== undefined
          ? { progressTotal: current.progressTotal }
          : {}),
      status: state,
    });
    if (values.cycleComplete === true && cycleParent) {
      const group = this.state.steps.get(cycleParent);
      if (group) group.status = "completed";
    }
    if (!this.state.active) this.set(this.state.labels!.preparing);
    else this.render();
  }

  private cycleParent(
    values: Record<string, unknown>,
    prefix: string,
    workflowParent: string | undefined,
    reentrant: boolean,
    state: WorkflowStepStatus,
  ) {
    const cycle = object(values.cycle);
    const id = typeof cycle.id === "string" ? cycle.id : undefined;
    const startField =
      typeof cycle.start_field === "string" ? cycle.start_field : undefined;
    if (!id || !startField) return undefined;
    const scope = `${prefix}:cycle:${id}`;
    const starts =
      reentrant &&
      state === "running" &&
      values[startField] === cycle.start_value;
    const active = this.state.cycles.get(scope) ?? { next: 0 };
    if (starts) {
      for (const step of this.state.steps.values())
        if (step.parentKey === workflowParent && step.status === "running")
          step.status = "completed";
      active.next += 1;
      active.activeKey = `${scope}:${active.next}`;
      this.state.steps.set(active.activeKey, {
        key: active.activeKey,
        label: this.cycleLabel(cycle, values),
        ...(workflowParent ? { parentKey: workflowParent } : {}),
        status: "running",
      });
    }
    this.state.cycles.set(scope, active);
    return active.activeKey;
  }

  private cycleLabel(
    cycle: Record<string, unknown>,
    values: Record<string, unknown>,
  ) {
    const label = this.workflowStepLabel(
      { label: cycle.label },
      typeof cycle.id === "string" ? cycle.id : "cycle",
    );
    const address =
      typeof values.address === "string" ? values.address : undefined;
    const total = typeof values.total === "number" ? values.total : undefined;
    return address && total !== undefined
      ? `${label} (${address}, ${this.compactBytes(total)})`
      : label;
  }

  private workflowParentKey(values: Record<string, unknown>, device: string) {
    const parent = object(values.workflowStep ?? {});
    const workflowId =
      typeof parent.workflowId === "string" ? parent.workflowId : undefined;
    const stepId =
      typeof parent.stepId === "string" ? parent.stepId : undefined;
    const displayId =
      typeof parent.displayId === "string" ? parent.displayId : stepId;
    return workflowId && displayId
      ? [device, workflowId, displayId].join(":")
      : undefined;
  }

  private adapterProgressLabel(
    values: Record<string, unknown>,
    fallback: string,
  ) {
    const label = this.workflowStepLabel(values, fallback);
    if (
      typeof values.percent === "number" &&
      typeof values.current === "number" &&
      typeof values.total === "number"
    )
      return `${label} (${values.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%, ${this.compactBytes(values.current)}/${this.compactBytes(values.total)})`;
    if (typeof values.percent === "number")
      return `${label} (${values.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%)`;
    if (typeof values.current === "number" && typeof values.total === "number")
      return `${label} (${values.current}/${values.total})`;
    if (typeof values.address === "string")
      return `${label} (${values.address})`;
    return label;
  }

  private compactBytes(value: number) {
    const units = ["B", "KiB", "MiB", "GiB"];
    let scaled = Math.max(0, value);
    let unit = 0;
    while (scaled >= 1024 && unit < units.length - 1) {
      scaled /= 1024;
      unit += 1;
    }
    return unit === 0
      ? `${Math.round(scaled)} B`
      : `${scaled.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
  }

  private renderWorkflowStep(step: WorkflowStepState, depth: number) {
    const marker =
      step.status === "completed"
        ? this.theme.success("✓")
        : step.status === "failed"
          ? this.theme.error("x")
          : step.status === "skipped"
            ? this.theme.muted("-")
            : step.status === "pending"
              ? this.theme.muted("-")
              : this.theme.argument(spinnerFrames[this.state.frame]);
    return `${"  ".repeat(depth)}${marker} ${this.theme.muted(step.label)}`;
  }
}
