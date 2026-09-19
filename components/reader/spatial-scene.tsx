"use client";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SpatialSceneProps as Contract,
  ReadingSurface,
  PassageHandle,
  SurfaceInstanceId,
  DocumentRenderContext,
} from "../../lib/reader/spatial-contract";
import type { SurfaceRole } from "../../lib/reader/attention";
import type { SpaceView } from "../../lib/reader/space-view";
import {
  cameraTransform,
  paperTransform,
  paperToWorld,
  paperPoint,
  worldToScreen,
  focusCamera,
  worldPoint,
  orientation,
  type PaperPose,
  type CameraViewport,
} from "../../lib/reader/camera";
import { SceneGeometry } from "./scene-geometry";
import { defaultPaperPose, rangeScrollTarget } from "./scene-presentation";
import { SceneInteraction } from "./scene-interaction";
import { relationStyle } from "../../lib/reader/semantic-palette";
import "./spatial-scene.css";
export interface SpatialSceneController {
  cancelInput(): void;
  measure(): void;
}
export type SpatialSceneProps = Omit<
  Contract,
  "renderDocument" | "renderDocumentMenu"
> & {
  controllerRef?: React.Ref<SpatialSceneController>;
  renderDocument(
    surface: ReadingSurface,
    role: SurfaceRole,
    context: DocumentRenderContext,
  ): React.ReactNode;
  renderDocumentMenu?(
    surface: ReadingSurface,
    role: SurfaceRole,
  ): React.ReactNode;
};
export type {
  ReadingSurface,
  ReturnLeaf,
  PendingSurface,
} from "../../lib/reader/spatial-contract";
type Loaded = { surface: ReadingSurface; role: SurfaceRole };
type Band = { id: string; path: string; color: string; label: string };
const initialViewport = { width: 1280, height: 850 };
function ScenePaper({
  entry,
  pose,
  viewport,
  register,
  registerPassage,
  invalidate,
  onScroll,
  onFocus,
  renderDocument,
  renderDocumentMenu,
}: {
  entry: Loaded;
  pose: PaperPose;
  viewport: CameraViewport;
  register(id: SurfaceInstanceId, node: HTMLElement | null): void;
  registerPassage(id: SurfaceInstanceId, handle: PassageHandle | null): void;
  invalidate(): void;
  onScroll(id: SurfaceInstanceId, top: number): void;
  onFocus(id: SurfaceInstanceId): void;
  renderDocument: SpatialSceneProps["renderDocument"];
  renderDocumentMenu: SpatialSceneProps["renderDocumentMenu"];
}) {
  const { surface, role } = entry;
  const width = Math.min(600, Math.max(320, viewport.width - 48));
  const height = Math.max(300, Math.min(780, viewport.height - 150));
  const context = useMemo<DocumentRenderContext>(
    () => ({
      registerPassage: (handle) => registerPassage(surface.surfaceId, handle),
      onGeometryChange: invalidate,
    }),
    [surface.surfaceId, registerPassage, invalidate],
  );
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <article
      ref={(node) => register(surface.surfaceId, node)}
      className="spatial-paper"
      data-paper
      data-surface-key={surface.surfaceId}
      data-document-id={surface.document.id}
      data-revision-id={surface.document.revisionId}
      aria-label={surface.document.title}
      style={{ width, height, transform: paperTransform(pose, width, height) }}
      onPointerDown={(event) => {
        down.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const previous = down.current;
        down.current = null;
        if (
          !previous ||
          Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 5
        )
          return;
        if (
          (event.target as Element).closest(
            "button,a,input,textarea,[data-paper-grip]",
          )
        )
          return;
        if (window.getSelection()?.isCollapsed === false) return;
        onFocus(surface.surfaceId);
      }}
    >
      <header className="spatial-paper-header">
        <div>
          <h2>{surface.document.title}</h2>
          <span>v{surface.document.sequence}</span>
        </div>
        {renderDocumentMenu?.(surface, role)}
      </header>
      <div
        className="spatial-paper-scroll"
        data-document-scroll
        onScroll={(event) =>
          onScroll(surface.surfaceId, event.currentTarget.scrollTop)
        }
      >
        {renderDocument(surface, role, context)}
      </div>
      {(["top", "right", "bottom", "left"] as const).map((side, index) => (
        <div
          key={side}
          data-paper-grip={surface.surfaceId}
          className={`spatial-paper-edge spatial-paper-edge-${side}`}
          tabIndex={index === 0 ? 0 : -1}
          role="separator"
          aria-label={`移动纸页：${surface.document.title}。方向键平移，Shift 加上下键调整远近。`}
          title="拖动纸边移动；Shift 拖动调整远近"
        />
      ))}
    </article>
  );
}
export function SpatialScene(props: SpatialSceneProps) {
  const {
    current: currentSurface,
    companion: companionSurface,
    pending,
    documents,
    onReadBeside,
  } = props;
  const viewportRef = useRef<HTMLDivElement>(null),
    worldRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<SurfaceInstanceId, HTMLElement>()),
    passages = useRef(new Map<SurfaceInstanceId, PassageHandle>());
  const geometry = useRef(new SceneGeometry());
  const interaction = useRef(new SceneInteraction());
  const [viewport, setViewport] = useState(initialViewport),
    [view, setView] = useState(props.view),
    [bands, setBands] = useState<Band[]>([]),
    [measureEpoch, setMeasureEpoch] = useState(0);
  const live = useRef(view);
  const propsRef = useRef(props);
  const viewportValue = useRef(viewport);
  const loaded = useMemo<Loaded[]>(
    () => [
      ...(currentSurface
        ? [{ surface: currentSurface, role: "current" as const }]
        : []),
      ...(companionSurface
        ? [{ surface: companionSurface, role: "companion" as const }]
        : []),
    ],
    [currentSurface, companionSurface],
  );
  const loadedRef = useRef(loaded);
  useLayoutEffect(() => {
    propsRef.current = props;
    viewportValue.current = viewport;
    loadedRef.current = loaded;
  }, [props, viewport, loaded]);
  const poseFor = useCallback(
    (value: SpaceView, id: SurfaceInstanceId) =>
      value.placements.get(id) ??
      defaultPaperPose(
        Math.max(
          0,
          loadedRef.current.findIndex(
            (entry) => entry.surface.surfaceId === id,
          ),
        ),
      ),
    [],
  );
  const paint = useCallback((value: SpaceView) => {
    live.current = value;
    setView(value);
  }, []);
  const checkpoint = useCallback(
    (value: SpaceView) => {
      paint(value);
      propsRef.current.onViewCheckpoint({
        generation: propsRef.current.presentation.id,
        view: value,
      });
    },
    [paint],
  );
  const invalidate = useCallback(() => {
    geometry.current.invalidate();
    setMeasureEpoch((value) => value + 1);
  }, []);
  const register = useCallback(
    (id: SurfaceInstanceId, node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    [],
  );
  const registerPassage = useCallback(
    (id: SurfaceInstanceId, handle: PassageHandle | null) => {
      if (handle) passages.current.set(id, handle);
      else passages.current.delete(id);
    },
    [],
  );
  const focus = useCallback(
    (id: SurfaceInstanceId) => {
      if (interaction.current.consumeClick()) return;
      const current = live.current;
      checkpoint({
        ...current,
        focus: id,
        camera: focusCamera(current.camera, poseFor(current, id)),
      });
    },
    [checkpoint, poseFor],
  );
  // Temporary loading adapter: Slice 2 replaces only this pair and the catalogue
  // activation with persistent occurrences. Camera focus already leaves poses alone.
  const seeded = useRef(false);
  const initialFocus = useRef(false);
  const requestedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (seeded.current || !currentSurface || companionSurface || pending)
      return;
    const next = documents.find(
      (doc) =>
        !doc.archived && doc.revisionId !== currentSurface?.document.revisionId,
    );
    if (next) {
      seeded.current = true;
      onReadBeside({
        documentId: next.id,
        revisionId: next.revisionId,
        focus: null,
      });
    }
  }, [currentSurface, companionSurface, pending, documents, onReadBeside]);
  useLayoutEffect(() => {
    const next = { ...props.view, placements: new Map(props.view.placements) };
    for (const [index, { surface }] of loaded.entries())
      if (!next.placements.has(surface.surfaceId))
        next.placements.set(surface.surfaceId, defaultPaperPose(index));
    let destination: SpaceView = next;
    const requested = loaded.find(
      (entry) => entry.surface.document.id === requestedFocus.current,
    );
    if ((!initialFocus.current && loaded.length) || requested) {
      const surface = (requested ?? loaded[0]).surface;
      initialFocus.current = true;
      requestedFocus.current = null;
      destination = {
        ...next,
        focus: surface.surfaceId,
        camera: focusCamera(next.camera, poseFor(next, surface.surfaceId)),
      };
    }
    live.current = destination;
    setView(destination);
    if (
      destination !== next ||
      next.placements.size !== props.view.placements.size
    )
      propsRef.current.onViewCheckpoint({
        generation: propsRef.current.presentation.id,
        view: destination,
      });
  }, [props.view, loaded, poseFor]);
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
      invalidate();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [invalidate]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    interaction.current.configure({
      context: () => {
        const rect = node.getBoundingClientRect();
        return {
          generation: propsRef.current.presentation.id,
          view: live.current,
          viewport: viewportValue.current,
          offset: { left: rect.left, top: rect.top },
          element: node,
        };
      },
      pose: poseFor,
      paint,
      checkpoint: (value) => propsRef.current.onViewCheckpoint(value),
      settled: () => {},
      stopPresentation: () => {},
    });
    const owner = interaction.current;
    const wheel = (event: WheelEvent) => owner.wheel(event);
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      owner.dispose();
    };
  }, [paint, poseFor]);
  useImperativeHandle(
    props.controllerRef,
    () => ({
      cancelInput: () => {
        interaction.current.cancel();
      },
      measure: invalidate,
    }),
    [invalidate],
  );
  const restored = useRef(new Map<SurfaceInstanceId, string>());
  useLayoutEffect(() => {
    const geometryOwner = geometry.current,
      node = viewportRef.current;
    if (!node) return;
    geometryOwner.setContext(
      JSON.stringify([
        viewport,
        loaded.map(({ surface }) => [
          surface.surfaceId,
          surface.document.revisionId,
          surface.position.focus,
        ]),
        props.connections.map((connection) => [
          connection.id,
          connection.from,
          connection.to,
        ]),
      ]),
    );
    const measure = geometryOwner.dirty;
    const restore = measure
      ? geometryOwner.measureLayout(
          node.getBoundingClientRect(),
          worldRef.current,
          nodes.current,
          new Map(),
        )
      : () => {};
    const local = new Map<
      string,
      { id: SurfaceInstanceId; points: { x: number; y: number }[] }
    >();
    try {
      for (const { surface } of loaded) {
        const scroll = nodes.current
          .get(surface.surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        if (!scroll) continue;
        const key = `${surface.document.revisionId}:${props.presentation.id}`;
        if (restored.current.get(surface.surfaceId) !== key) {
          scroll.scrollTop = surface.position.scrollTop;
          const anchor = surface.position.focus;
          if (anchor && props.presentation.kind === "align-ranges") {
            const resolved = geometryOwner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
            if (resolved?.fragments.length) {
              const top = Math.min(...resolved.fragments.map((r) => r.top)),
                bottom = Math.max(...resolved.fragments.map((r) => r.bottom));
              scroll.scrollTop = rangeScrollTarget(
                top,
                bottom,
                resolved.coverage === "complete",
                scroll.clientHeight,
                scroll.scrollHeight - scroll.clientHeight,
              );
            }
          }
          restored.current.set(surface.surfaceId, key);
        }
      }
      for (const connection of props.connections)
        for (const endpoint of ["from", "to"] as const) {
          const anchor = connection[endpoint];
          const entry = loaded.find(
            (item) => item.surface.document.revisionId === anchor.revisionId,
          );
          if (!entry) continue;
          const id = entry.surface.surfaceId,
            scroll = nodes.current
              .get(id)
              ?.querySelector<HTMLElement>("[data-document-scroll]"),
            layout = geometryOwner.layouts.get(id);
          if (!scroll || !layout) continue;
          const resolved = geometryOwner.resolveAnchor(
            id,
            anchor,
            passages.current.get(id),
            scroll,
            measure,
          );
          if (!resolved?.fragments.length) continue;
          const fragments = resolved.fragments.filter(
            (r) =>
              r.bottom - scroll.scrollTop > 0 &&
              r.top - scroll.scrollTop < scroll.clientHeight,
          );
          if (!fragments.length) continue;
          const r = fragments[0];
          const left = layout.scroll.left + r.left,
            right = layout.scroll.left + r.right;
          const top = layout.scroll.top + Math.max(0, r.top - scroll.scrollTop),
            bottom =
              layout.scroll.top +
              Math.min(scroll.clientHeight, r.bottom - scroll.scrollTop);
          local.set(`${connection.id}:${endpoint}`, {
            id,
            points: [
              { x: left, y: top },
              { x: right, y: top },
              { x: right, y: bottom },
              { x: left, y: bottom },
            ],
          });
        }
    } finally {
      restore();
      geometryOwner.dirty = false;
    }
    const result: Band[] = [];
    for (const connection of props.connections) {
      const from = local.get(`${connection.id}:from`),
        to = local.get(`${connection.id}:to`);
      if (!from || !to) continue;
      const project = (end: typeof from) => {
        const layout = geometryOwner.layouts.get(end.id)!;
        return end.points.map((p) =>
          worldToScreen(
            paperToWorld(
              paperPoint(p.x, p.y),
              poseFor(view, end.id),
              layout.width,
              layout.height,
            ),
            view.camera,
            viewport,
          ),
        );
      };
      const a = project(from),
        b = project(to);
      if (
        [...a, ...b].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
      )
        continue;
      const points =
        a[0].x < b[0].x ? [a[1], b[0], b[3], a[2]] : [a[0], b[1], b[2], a[3]];
      result.push({
        id: connection.id,
        path: `M ${points.map((p) => `${p.x},${p.y}`).join(" L ")} Z`,
        color: relationStyle(connection.relation)["--relation-signal"],
        label: connection.label || connection.relation,
      });
    }
    setBands(result);
  }, [
    loaded,
    props.connections,
    props.presentation,
    viewport,
    view,
    measureEpoch,
    poseFor,
  ]);
  const scroll = useCallback((id: SurfaceInstanceId, top: number) => {
    propsRef.current.onScroll(id, top, propsRef.current.presentation.id);
    setMeasureEpoch((value) => value + 1);
  }, []);
  const folds = props.documents.filter(
    (doc) =>
      !loaded.some(
        (entry) => entry.surface.document.revisionId === doc.revisionId,
      ),
  );
  return (
    <div
      ref={viewportRef}
      className="spatial-scene"
      data-hit-role="stage"
      aria-label="三维文档空间"
      style={{ perspective: view.camera.perspective }}
      onPointerDown={(e) => interaction.current.pointerDown(e)}
      onPointerMove={(e) => interaction.current.pointerMove(e)}
      onPointerUp={(e) => interaction.current.pointerUp(e)}
      onPointerCancel={() => interaction.current.cancel()}
      onLostPointerCapture={(event) =>
        interaction.current.lostPointerCapture(event)
      }
      onKeyDown={(e) => {
        if (interaction.current.keyDown(e)) return;
        if (e.key === "Escape" && view.focus) {
          checkpoint({ ...view, focus: null });
        }
      }}
    >
      <div
        className="spatial-scene-world"
        ref={worldRef}
        style={{ transform: cameraTransform(view.camera) }}
      >
        {loaded.map((entry, index) => (
          <ScenePaper
            key={entry.surface.surfaceId}
            entry={entry}
            pose={
              view.placements.get(entry.surface.surfaceId) ??
              defaultPaperPose(index)
            }
            viewport={viewport}
            register={register}
            registerPassage={registerPassage}
            invalidate={invalidate}
            onScroll={scroll}
            onFocus={focus}
            renderDocument={props.renderDocument}
            renderDocumentMenu={props.renderDocumentMenu}
          />
        ))}
        {folds.map((document, index) => {
          const pose = {
            position: worldPoint(
              ((index % 5) - 2) * 235,
              Math.floor(index / 5) * 160 - 480,
              -620 - (index % 3) * 110,
            ),
            orientation: orientation(6, ((index % 5) - 2) * 5),
          };
          return (
            <button
              key={document.id}
              className="spatial-fold"
              style={{ transform: paperTransform(pose, 205, 116) }}
              onClick={() => {
                requestedFocus.current = document.id;
                props.onReadBeside({
                  documentId: document.id,
                  revisionId: document.revisionId,
                  focus: null,
                });
              }}
              aria-label={`打开文档：${document.title}`}
            >
              <span>{document.title}</span>
              <small>v{document.sequence}</small>
            </button>
          );
        })}
      </div>
      <svg
        className="spatial-bands"
        width={viewport.width}
        height={viewport.height}
        aria-label="段落关联"
      >
        {bands.map((band) => (
          <path
            key={band.id}
            d={band.path}
            style={{ fill: band.color }}
            onClick={() =>
              props.onFollow({
                connectionId: band.id as Parameters<
                  typeof props.onFollow
                >[0]["connectionId"],
                origin: { kind: "bridge" },
              })
            }
          >
            <title>{band.label}</title>
          </path>
        ))}
      </svg>
      {props.pending && (
        <div className="spatial-load-status" role="status">
          {props.pending.error ?? `正在读取 ${props.pending.title}…`}
          {props.pending.error && (
            <button onClick={() => props.onReadBeside(props.pending!.target)}>
              重试
            </button>
          )}
        </div>
      )}
      <p className="spatial-gesture-hint">
        拖动空白环顾 · Shift 拖动平移 · 滚轮靠近 · 拖动纸边移动 · Shift
        拖动纸边调整远近
      </p>
    </div>
  );
}
