"use client";
import { useEffect, useRef, useState } from "react";
/** The two curves terminate on the selected passages' actual rendered bounds. */
export function ConnectionLines({
  revisionKey,
  label,
}: {
  revisionKey: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [lines, setLines] = useState<{
      paths: string[];
      height: number;
      labelY: number;
    } | null>(null);
  useEffect(() => {
    const gutter = ref.current,
      papers = gutter?.parentElement;
    if (!gutter || !papers) return;
    const measure = () => {
      const first = papers.querySelector(
          ".paper:not(.comparison-paper) .passage-focus",
        ),
        second = papers.querySelector(".comparison-paper .passage-focus");
      if (!first || !second) return;
      const g = gutter.getBoundingClientRect(),
        a = first.getBoundingClientRect(),
        b = second.getBoundingClientRect();
      if (g.width > g.height) {
        setLines(null);
        return;
      }
      const ay = Math.max(12, a.top - g.top),
        by = Math.max(12, b.top - g.top),
        ay2 = ay + Math.min(a.height, 40),
        by2 = by + Math.min(b.height, 40);
      setLines({
        paths: [
          `M0 ${ay} C${g.width * 0.6} ${ay} ${g.width * 0.4} ${by} ${g.width} ${by}`,
          `M0 ${ay2} C${g.width * 0.6} ${ay2} ${g.width * 0.4} ${by2} ${g.width} ${by2}`,
        ],
        height: g.height,
        labelY: (ay + by) / 2,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(papers);
    const timer = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [revisionKey]);
  return (
    <div
      ref={ref}
      className="connection-gutter"
      aria-label={`双向文字连接：${label}`}
    >
      {lines ? (
        <svg style={{ height: lines.height }}>
          {lines.paths.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          ))}
        </svg>
      ) : (
        <svg viewBox="0 0 90 50" preserveAspectRatio="none">
          <path
            d="M20 0C20 30 70 20 70 50 M25 0C25 30 75 20 75 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      )}
      <span style={lines ? { top: lines.labelY } : undefined}>{label}</span>
    </div>
  );
}
