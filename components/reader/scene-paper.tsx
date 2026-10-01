"use client";
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { AnchorInput } from "../../lib/domain/model";
import type { PassageMouth } from "../../lib/reader/passage-mouth";
import type {
  DocumentRenderContext,
  PassageHandle,
  SpaceSurface,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import type { ReadingRole } from "../../lib/reader/reading-presentation";
import type { SpatialSceneProps } from "./spatial-scene";

export type PaperProxy = { key: string; mouth: PassageMouth; color: string };
const proxyLabels = {
  offscreen: "原文在可见范围外",
  unmapped: "原文范围无法映射",
  unmounted: "正文尚未显示",
  loading: "正文加载中",
  error: "正文加载失败",
};
export function ScenePaper({
  surface,
  resident,
  readingRole,
  readingActive,
  intrinsicHeight,
  contextLabel,
  element,
  proxies,
  onRetry,
  registerPassage,
  invalidate,
  registerAnchors,
  hitTestAnchor,
  onScroll,
  onFocus,
  renderDocument,
  renderDocumentMenu,
}: {
  surface: SpaceSurface;
  resident: boolean;
  readingRole: ReadingRole;
  readingActive: boolean;
  intrinsicHeight: number;
  contextLabel: string;
  element: HTMLElement;
  proxies: readonly PaperProxy[];
  onRetry(id: SurfaceInstanceId): void;
  registerPassage(id: SurfaceInstanceId, handle: PassageHandle | null): void;
  invalidate(id?: SurfaceInstanceId): void;
  registerAnchors(id: SurfaceInstanceId, anchors: readonly AnchorInput[]): void;
  hitTestAnchor(
    id: SurfaceInstanceId,
    anchor: AnchorInput,
    point: { x: number; y: number },
  ): boolean;
  onScroll(id: SurfaceInstanceId, top: number): void;
  onFocus(id: SurfaceInstanceId): void;
  renderDocument: SpatialSceneProps["renderDocument"];
  renderDocumentMenu: SpatialSceneProps["renderDocumentMenu"];
}) {
  const document = surface.document ?? surface.metadata;
  const title = document?.title ?? "正在读取文档…";
  const reading = surface.document
    ? {
        surfaceId: surface.surfaceId,
        position: surface.position,
        document: surface.document,
      }
    : null;
  const context = useMemo<DocumentRenderContext>(
    () => ({
      registerPassage: (handle) => registerPassage(surface.surfaceId, handle),
      onGeometryChange: () => invalidate(surface.surfaceId),
      registerAnchors: (anchors) => registerAnchors(surface.surfaceId, anchors),
      hitTestAnchor: (anchor, point) =>
        hitTestAnchor(surface.surfaceId, anchor, point),
    }),
    [
      surface.surfaceId,
      registerPassage,
      invalidate,
      registerAnchors,
      hitTestAnchor,
    ],
  );
  useLayoutEffect(() => {
    element.setAttribute("data-document-id", surface.position.documentId);
    element.setAttribute("data-revision-id", surface.position.revisionId);
    element.setAttribute("data-residency", resident ? "resident" : "metadata");
    element.setAttribute("data-reading-role", readingRole);
    element.setAttribute("data-reading-active", String(readingActive));
    element.setAttribute(
      "data-context-density",
      intrinsicHeight < 50 ? "compact" : "full",
    );
    element.setAttribute(
      "data-compact",
      intrinsicHeight < 100
        ? "minimal"
        : intrinsicHeight < 220
          ? "short"
          : "normal",
    );
    element.setAttribute("aria-label", title);
    element.setAttribute("tabindex", "-1");
  }, [
    element,
    surface.position.documentId,
    surface.position.revisionId,
    resident,
    readingRole,
    readingActive,
    intrinsicHeight,
    title,
  ]);
  const down = useRef<{ x: number; y: number } | null>(null);
  return createPortal(
    <div
      className="spatial-paper-content"
      onPointerDown={(event) => {
        down.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const previous = down.current;
        down.current = null;
        if (
          event.defaultPrevented ||
          !previous ||
          Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 5
        )
          return;
        if (
          (event.target as Element).closest(
            "button,a,input,textarea,[data-paper-grip]",
          ) ||
          window.getSelection()?.isCollapsed === false
        )
          return;
        onFocus(surface.surfaceId);
      }}
    >
      {readingActive && readingRole === "context" ? (
        <button
          className="spatial-context-focus"
          type="button"
          aria-label={`继续阅读：${title}`}
          title={`${document?.path ?? surface.position.documentId} · ${document ? `v${document.sequence}` : "文档"} · ${contextLabel}`}
          onClick={() => onFocus(surface.surfaceId)}
        >
          <strong>{title}</strong>
          <span className="spatial-context-identity">
            {document?.path ?? surface.position.documentId} ·{" "}
            {document ? `v${document.sequence}` : "文档"}
          </span>
          <span className="spatial-context-provenance">{contextLabel}</span>
        </button>
      ) : (
        <>
          <header
            className="spatial-paper-header"
            data-paper-grip={surface.surfaceId}
            title="拖动标题或纸边移动；Shift 拖动调整远近"
          >
            <div>
              <h2>{title}</h2>
              <span>
                {readingRole === "primary" ? "正在阅读" : "关联原文"} ·{" "}
                {document ? `v${document.sequence}` : "文档"}
              </span>
            </div>
            {reading && renderDocumentMenu?.(reading)}
          </header>
          <div
            className="spatial-paper-scroll"
            data-document-scroll
            onScroll={(event) => {
              if (resident && reading)
                onScroll(surface.surfaceId, event.currentTarget.scrollTop);
            }}
          >
            {resident && reading ? (
              renderDocument(reading, context)
            ) : (
              <div className="spatial-paper-placeholder">
                <p role="status">
                  {surface.error ??
                    (resident ? "正在读取正文…" : "靠近或点击纸页读取正文")}
                </p>
                {surface.payload === "error" && (
                  <button onClick={() => onRetry(surface.surfaceId)}>
                    重试
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {(["top", "right", "bottom", "left"] as const).map((side, index) => (
        <div
          key={side}
          data-paper-grip={surface.surfaceId}
          className={`spatial-paper-edge spatial-paper-edge-${side}`}
          tabIndex={index === 0 ? 0 : -1}
          role="separator"
          aria-label={`移动纸页：${title}。方向键平移，Shift 加上下键调整远近。`}
          title="拖动纸边移动；Shift 拖动调整远近"
        />
      ))}
      {proxies.map(
        ({ key, mouth, color }) =>
          mouth.precision !== "exact" && (
            <div
              key={key}
              className="spatial-range-proxy"
              data-proxy-status={mouth.reason}
              title={proxyLabels[mouth.reason]}
              style={{
                left: Math.max(
                  8,
                  Math.min(482, (mouth.start.x + mouth.end.x) / 2 - 55),
                ),
                top: Math.max(
                  8,
                  Math.min(754, (mouth.start.y + mouth.end.y) / 2 - 9),
                ),
                borderColor: color,
              }}
            >
              {proxyLabels[mouth.reason]}
            </div>
          ),
      )}
    </div>,
    element,
  );
}
