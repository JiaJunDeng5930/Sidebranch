/** Browser-only QA telemetry. Imported solely by the unpublished QA harness. */
export function observeReaderPerformance() {
  const started = performance.now();
  const metrics = {
    started,
    longTasks: 0,
    longestTaskMs: 0,
    totalBlockingMs: 0,
    inputPaintMs: [] as number[],
    frameGapsMs: [] as number[],
  };
  const publish = () => {
    document.documentElement.dataset.qaPerformance = JSON.stringify(metrics);
  };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime + entry.duration < metrics.started) continue;
      metrics.longTasks++;
      metrics.longestTaskMs = Math.max(metrics.longestTaskMs, entry.duration);
      metrics.totalBlockingMs += Math.max(0, entry.duration - 50);
    }
    publish();
  });
  try {
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    /* Unsupported browser. */
  }
  let measuring = false;
  const input = () => {
    const eventAt = performance.now();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        metrics.inputPaintMs.push(performance.now() - eventAt);
        if (metrics.inputPaintMs.length > 200) metrics.inputPaintMs.shift();
        publish();
      }),
    );
    if (measuring) return;
    measuring = true;
    let last = performance.now();
    const frame = (at: number) => {
      if (at >= last) metrics.frameGapsMs.push(at - last);
      last = at;
      if (metrics.frameGapsMs.length > 600) metrics.frameGapsMs.shift();
      if (at - eventAt < 1000) requestAnimationFrame(frame);
      else {
        measuring = false;
        publish();
      }
    };
    requestAnimationFrame(frame);
  };
  document.addEventListener("keydown", input, { passive: true });
  document.addEventListener("pointerdown", input, { passive: true });
  document.addEventListener("wheel", input, { passive: true });
  const reset = () => {
    metrics.started = performance.now();
    metrics.longTasks = 0;
    metrics.longestTaskMs = 0;
    metrics.totalBlockingMs = 0;
    metrics.inputPaintMs = [];
    metrics.frameGapsMs = [];
    publish();
  };
  document.addEventListener("qa-reset-performance", reset);
  publish();
  return () => {
    document.removeEventListener("qa-reset-performance", reset);
    observer.disconnect();
    document.removeEventListener("keydown", input);
    document.removeEventListener("pointerdown", input);
    document.removeEventListener("wheel", input);
  };
}
