import { useEffect, useRef, useState } from "react";

const SAMPLE_DURATION_MS = 5_000;
const PANEL_SELECTOR = "[data-qa-performance-panel]";

type SampleStatus = "ready" | "measuring" | "complete" | "invalid";

type SurfaceSnapshot = {
  bodyCount: number;
  domNodeCount: number;
  sourceSpanCount: number;
  chunkCount: number;
};

export type PerformanceSample = {
  surface: string;
  status: Exclude<SampleStatus, "ready" | "measuring">;
  startedAt: number;
  elapsedMs: number;
  frameCount: number;
  frameIntervalsMs: number[];
  doubleRafProxyMs: number[];
  longTaskSupported: boolean;
  longTaskCount: number | null;
  longestTaskMs: number | null;
  visibilityStart: DocumentVisibilityState;
  visibilityEnd: DocumentVisibilityState;
  visibilityChanged: boolean;
  viewportStart: string;
  viewportEnd: string;
  snapshot: SurfaceSnapshot;
  invalidReasons: string[];
};

type SampleCallbacks = {
  onStart: (startedAt: number) => void;
  onComplete: (sample: PerformanceSample) => void;
};

export type PerformanceSampleSampler = {
  start: (callbacks: SampleCallbacks) => void;
  cancel: () => void;
  isActive: () => boolean;
};

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function formatMs(value: number | null): string {
  return value === null ? "insufficient samples" : `${value.toFixed(1)} ms`;
}

function formatViewport(targetWindow: Window): string {
  const dpr = targetWindow.devicePixelRatio || 1;
  return `${targetWindow.innerWidth} × ${targetWindow.innerHeight} CSS px @ ${dpr.toFixed(2)}× DPR`;
}

function isInsidePanel(element: Element): boolean {
  return Boolean(element.closest(PANEL_SELECTOR));
}

function countOutsidePanel(
  targetDocument: Document,
  selector: string,
): number {
  let count = 0;
  for (const element of targetDocument.querySelectorAll(selector)) {
    if (!isInsidePanel(element)) count++;
  }
  return count;
}

function readSurfaceSnapshot(targetDocument: Document): SurfaceSnapshot {
  return {
    bodyCount: countOutsidePanel(targetDocument, "[data-document-scroll]"),
    domNodeCount: countOutsidePanel(targetDocument, "body *"),
    sourceSpanCount: countOutsidePanel(targetDocument, "[data-source-start]"),
    chunkCount: countOutsidePanel(targetDocument, "[data-document-chunk-index]"),
  };
}

function readLongTasks(
  targetWindow: Window,
  startedAt: number,
  endedAt: number,
): { count: number | null; longest: number | null } {
  const entries = targetWindow.performance
    .getEntriesByType("longtask")
    .filter(
      (entry) =>
        entry.startTime >= startedAt && entry.startTime <= endedAt,
    );
  if (entries.length === 0) return { count: 0, longest: 0 };
  return {
    count: entries.length,
    longest: Math.max(...entries.map((entry) => entry.duration)),
  };
}

function longTaskIsSupported(): boolean {
  const observer = typeof PerformanceObserver === "undefined" ? null : PerformanceObserver;
  return Boolean(
    observer && observer.supportedEntryTypes?.includes("longtask"),
  );
}

export function createPerformanceSampleSampler(
  targetDocument: Document = document,
  targetWindow: Window = targetDocument.defaultView ?? window,
): PerformanceSampleSampler {
  let active = false;
  let frameRequest: number | null = null;
  let finishTimer: number | null = null;
  const proxyRequests = new Set<number>();
  let stopListeners: (() => void) | null = null;
  let stopObserver: (() => void) | null = null;

  const cancel = () => {
    active = false;
    if (frameRequest !== null) {
      targetWindow.cancelAnimationFrame(frameRequest);
      frameRequest = null;
    }
    for (const request of proxyRequests)
      targetWindow.cancelAnimationFrame(request);
    proxyRequests.clear();
    if (finishTimer !== null) {
      targetWindow.clearTimeout(finishTimer);
      finishTimer = null;
    }
    stopListeners?.();
    stopListeners = null;
    stopObserver?.();
    stopObserver = null;
  };

  const start = ({ onStart, onComplete }: SampleCallbacks) => {
    cancel();
    active = true;
    const startedAt = targetWindow.performance.now();
    const visibilityStart = targetDocument.visibilityState;
    const viewportStart = formatViewport(targetWindow);
    const frameIntervalsMs: number[] = [];
    const doubleRafProxyMs: number[] = [];
    let frameCount = 0;
    let lastFrameAt: number | null = null;
    let visibilityChanged = false;
    let visibilityEnd = visibilityStart;
    let observer: PerformanceObserver | null = null;
    const longTaskSupported = longTaskIsSupported();

    onStart(startedAt);

    const onVisibilityChange = () => {
      visibilityChanged = true;
      visibilityEnd = targetDocument.visibilityState;
    };
    targetDocument.addEventListener("visibilitychange", onVisibilityChange);
    stopListeners = () =>
      targetDocument.removeEventListener("visibilitychange", onVisibilityChange);

    if (longTaskSupported) {
      try {
        observer = new PerformanceObserver(() => undefined);
        observer.observe({ type: "longtask", buffered: false });
        stopObserver = () => observer?.disconnect();
      } catch {
        observer = null;
      }
    }

    const inputProxy = () => {
      if (!active) return;
      const eventAt = targetWindow.performance.now();
      let firstRequest: number | null = null;
      try {
        firstRequest = targetWindow.requestAnimationFrame(() => {
          if (firstRequest !== null) proxyRequests.delete(firstRequest);
          if (!active) return;
          let secondRequest: number | null = null;
          secondRequest = targetWindow.requestAnimationFrame(() => {
            if (secondRequest !== null) proxyRequests.delete(secondRequest);
            if (active) {
              doubleRafProxyMs.push(targetWindow.performance.now() - eventAt);
            }
          });
          if (secondRequest !== null) proxyRequests.add(secondRequest);
        });
        if (firstRequest !== null) proxyRequests.add(firstRequest);
      } catch {
        // A throttled or unavailable document still ends through the timer.
      }
    };
    const inputOptions: AddEventListenerOptions = { passive: true };
    targetDocument.addEventListener("keydown", inputProxy, inputOptions);
    targetDocument.addEventListener("pointerdown", inputProxy, inputOptions);
    targetDocument.addEventListener("wheel", inputProxy, inputOptions);
    const removeInputListeners = () => {
      targetDocument.removeEventListener("keydown", inputProxy, inputOptions);
      targetDocument.removeEventListener("pointerdown", inputProxy, inputOptions);
      targetDocument.removeEventListener("wheel", inputProxy, inputOptions);
    };
    const previousStopListeners = stopListeners;
    stopListeners = () => {
      previousStopListeners?.();
      removeInputListeners();
    };

    const finish = () => {
      if (!active) return;
      active = false;
      if (frameRequest !== null) {
        targetWindow.cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      for (const request of proxyRequests)
        targetWindow.cancelAnimationFrame(request);
      proxyRequests.clear();
      if (finishTimer !== null) {
        targetWindow.clearTimeout(finishTimer);
        finishTimer = null;
      }
      stopListeners?.();
      stopListeners = null;
      stopObserver?.();
      stopObserver = null;

      const endedAt = targetWindow.performance.now();
      const elapsedMs = endedAt - startedAt;
      const longTasks = longTaskSupported
        ? readLongTasks(targetWindow, startedAt, endedAt)
        : { count: null, longest: null };
      const viewportEnd = formatViewport(targetWindow);
      const invalidReasons: string[] = [];
      if (elapsedMs < SAMPLE_DURATION_MS)
        invalidReasons.push("sample ended before 5 seconds");
      if (frameIntervalsMs.length < 2)
        invalidReasons.push("insufficient rAF samples");
      if (visibilityStart !== "visible" || visibilityEnd !== "visible")
        invalidReasons.push("document was not visible for the whole sample");
      if (visibilityChanged) invalidReasons.push("visibility changed during sample");
      const sample: PerformanceSample = {
        surface: "",
        status: invalidReasons.length > 0 ? "invalid" : "complete",
        startedAt,
        elapsedMs,
        frameCount,
        frameIntervalsMs: [...frameIntervalsMs],
        doubleRafProxyMs: [...doubleRafProxyMs],
        longTaskSupported,
        longTaskCount: longTasks.count,
        longestTaskMs: longTasks.longest,
        visibilityStart,
        visibilityEnd,
        visibilityChanged,
        viewportStart,
        viewportEnd,
        snapshot: readSurfaceSnapshot(targetDocument),
        invalidReasons,
      };
      onComplete(sample);
    };

    const frame = (at: number) => {
      if (!active) return;
      frameCount++;
      if (lastFrameAt !== null) frameIntervalsMs.push(at - lastFrameAt);
      lastFrameAt = at;
      try {
        frameRequest = targetWindow.requestAnimationFrame(frame);
      } catch {
        frameRequest = null;
      }
    };
    try {
      frameRequest = targetWindow.requestAnimationFrame(frame);
    } catch {
      frameRequest = null;
    }
    finishTimer = targetWindow.setTimeout(finish, SAMPLE_DURATION_MS);
  };

  return { start, cancel, isActive: () => active };
}

const initialState = { status: "ready" as const };
type PanelState =
  | typeof initialState
  | { status: "measuring"; startedAt: number }
  | { status: "complete" | "invalid"; sample: PerformanceSample };

function SampleMetrics({ sample }: { sample: PerformanceSample }) {
  const frameIntervals = sample.frameIntervalsMs;
  const doubleRaf = sample.doubleRafProxyMs;
  return (
    <dl data-qa-performance-output style={styles.metrics}>
      <dt>Result</dt>
      <dd data-qa-performance-result-status>
        {sample.status === "complete" ? "complete" : "invalid"}
        {sample.invalidReasons.length > 0
          ? ` — ${sample.invalidReasons.join("; ")}`
          : ""}
      </dd>
      <dt>Measured surface</dt>
      <dd>{sample.surface}</dd>
      <dt>Actual elapsed</dt>
      <dd>{formatMs(sample.elapsedMs)}</dd>
      <dt>rAF samples</dt>
      <dd>
        {sample.frameCount} callbacks / {frameIntervals.length} frame intervals
      </dd>
      <dt>Frame interval p50 / p95 / p99 / max</dt>
      <dd>
        {formatMs(percentile(frameIntervals, 0.5))} / {formatMs(percentile(frameIntervals, 0.95))} /{" "}
        {formatMs(percentile(frameIntervals, 0.99))} /{" "}
        {formatMs(frameIntervals.length > 0 ? Math.max(...frameIntervals) : null)}
      </dd>
      <dt>Double-rAF input proxy (actual input)</dt>
      <dd>
        {doubleRaf.length === 0
          ? "no actual input samples"
          : `${doubleRaf.length} samples; p50 ${formatMs(percentile(doubleRaf, 0.5))}; p95 ${formatMs(percentile(doubleRaf, 0.95))}; max ${formatMs(Math.max(...doubleRaf))}`}
      </dd>
      <dt>Long tasks &gt;50 ms</dt>
      <dd>
        {sample.longTaskSupported
          ? `${sample.longTaskCount ?? 0} tasks; max ${formatMs(sample.longestTaskMs)}`
          : "unsupported by this browser"}
      </dd>
      <dt>Visibility</dt>
      <dd>
        {sample.visibilityStart} → {sample.visibilityEnd}; changed {sample.visibilityChanged ? "yes" : "no"}
      </dd>
      <dt>Viewport</dt>
      <dd>
        start {sample.viewportStart}; end {sample.viewportEnd}
      </dd>
      <dt>Document bodies / DOM / source spans / chunks</dt>
      <dd>
        body {sample.snapshot.bodyCount}; DOM {sample.snapshot.domNodeCount}; source spans {sample.snapshot.sourceSpanCount}; chunks {sample.snapshot.chunkCount}
      </dd>
    </dl>
  );
}

export function QaPerformancePanel({
  surface,
  placement = "floating",
}: {
  surface: string;
  placement?: "floating" | "toolbar";
}) {
  const [state, setState] = useState<PanelState>(initialState);
  const [expanded, setExpanded] = useState(false);
  const samplerRef = useRef<PerformanceSampleSampler | null>(null);

  useEffect(() => {
    const sampler = createPerformanceSampleSampler();
    samplerRef.current = sampler;
    const reset = () => {
      sampler.cancel();
      setState(initialState);
      setExpanded(false);
    };
    document.addEventListener("qa-reset-performance", reset);
    return () => {
      document.removeEventListener("qa-reset-performance", reset);
      sampler.cancel();
      samplerRef.current = null;
    };
  }, []);

  const start = () => {
    const sampler = samplerRef.current;
    if (!sampler || sampler.isActive()) return;
    document.dispatchEvent(new Event("qa-reset-performance"));
    setExpanded(false);
    sampler.start({
      onStart: (startedAt) => setState({ status: "measuring", startedAt }),
      onComplete: (sample) => setState({ status: sample.status, sample: { ...sample, surface } }),
    });
  };

  return (
    <aside
      data-qa-performance-panel
      role="region"
      aria-label={`QA performance sample for ${surface}`}
      style={{
        ...styles.panel,
        ...(placement === "toolbar" ? styles.toolbarPanel : {}),
        maxHeight: expanded ? styles.panelExpandedMaxHeight : "none",
      }}
    >
      <div style={styles.header}>
        <strong>QA performance</strong>
        <span data-qa-performance-status aria-live="polite">
          {state.status === "ready"
            ? "ready"
            : state.status === "measuring"
              ? "measuring 5 seconds…"
              : state.status}
        </span>
      </div>
      <div style={styles.controls}>
        <button
          type="button"
          data-qa-performance-start
          disabled={state.status === "measuring"}
          onClick={start}
        >
          Start 5-second sample
        </button>
        <button
          type="button"
          data-qa-performance-reset
          onClick={() => document.dispatchEvent(new Event("qa-reset-performance"))}
        >
          Reset
        </button>
      </div>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        style={styles.results}
      >
        <summary style={styles.summary}>
          {state.status === "measuring"
            ? "Sampling guidance"
            : state.status === "ready"
              ? "Sampling guidance"
              : "Show sample results"}
        </summary>
        {state.status === "measuring" && (
          <p style={styles.note}>
            Use real scroll, drag, or keyboard input while this runs.
          </p>
        )}
        {state.status === "ready" && (
          <p style={styles.note}>
            Counts exclude this panel. Hidden or throttled samples are invalid.
          </p>
        )}
        {state.status === "complete" || state.status === "invalid" ? (
          <div style={styles.outputScroll}>
            <SampleMetrics sample={state.sample} />
          </div>
        ) : null}
      </details>
    </aside>
  );
}

const styles = {
  panel: {
    position: "fixed" as const,
    right: 12,
    bottom: 12,
    zIndex: 2_147_483_647,
    width: "min(320px, calc(100vw - 20px))",
    maxHeight: "none",
    overflow: "hidden",
    boxSizing: "border-box" as const,
    padding: "10px 12px",
    border: "1px solid rgba(231,184,121,.72)",
    borderRadius: 8,
    background: "rgba(20, 25, 31, .96)",
    color: "#f5f0e8",
    font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    boxShadow: "0 8px 28px rgba(0,0,0,.36)",
    pointerEvents: "auto" as const,
    touchAction: "manipulation" as const,
  },
  toolbarPanel: {
    position: "static" as const,
    right: "auto",
    bottom: "auto",
    zIndex: "auto",
    width: "min(360px, 100%)",
    maxWidth: "100%",
    margin: 0,
    boxShadow: "none",
  },
  panelExpandedMaxHeight: "min(62vh, 440px)",
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "baseline",
  },
  controls: {
    display: "flex",
    gap: 8,
    margin: "8px 0",
  },
  note: {
    margin: "6px 0 0",
    color: "#c9c0b4",
  },
  results: {
    marginTop: 4,
    maxWidth: "100%",
  },
  summary: {
    cursor: "pointer",
    color: "#e7b879",
    userSelect: "none" as const,
  },
  outputScroll: {
    maxHeight: "min(54vh, 360px)",
    overflow: "auto",
    overscrollBehavior: "contain" as const,
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)",
    gap: "3px 10px",
    margin: "8px 0 0",
    overflowWrap: "anywhere" as const,
  },
};
