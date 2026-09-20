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
import type { AnchorInput } from "../../lib/domain/model";
import type { SpaceView } from "../../lib/reader/space-view";
import {
  fitCameraToPaper,
  fitCameraToPapers,
  focusCamera,
  paperToWorld,
  screenPoint,
  toThreeQuaternion,
  toThreeWorld,
  type CameraViewport,
  type CameraPose,
} from "../../lib/reader/camera";
import { paperGeometryForViewport } from "../../lib/reader/paper-geometry";
import {
  SceneGeometry,
  resolvePassageMouth,
  visibleAnchorFragments,
} from "./scene-geometry";
import { defaultPaperPose, rangeScrollTarget } from "./scene-presentation";
import { SceneInteraction } from "./scene-interaction";
import { ScenePaper, type PaperProxy } from "./scene-paper";
import { ThreeSceneRuntime, type SceneBand } from "./three-scene-runtime";
import { desiredFullText } from "../../lib/reader/space-residency";
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
    context: DocumentRenderContext,
  ): React.ReactNode;
  renderDocumentMenu?(surface: ReadingSurface): React.ReactNode;
};
const initialViewport = { width: 1280, height: 850 };
export function SpatialScene(props: SpatialSceneProps) {
  const viewportRef = useRef<HTMLDivElement>(null),
    backgroundRef = useRef<HTMLDivElement>(null),
    rendererHostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<ThreeSceneRuntime | null>(null),
    interaction = useRef(new SceneInteraction());
  const nodes = useRef(new Map<SurfaceInstanceId, HTMLElement>()),
    passages = useRef(new Map<SurfaceInstanceId, PassageHandle>());
  const geometry = useRef(new SceneGeometry()),
    anchors = useRef(new Map<SurfaceInstanceId, readonly AnchorInput[]>());
  const propsRef = useRef(props),
    live = useRef(props.view),
    viewportValue = useRef<CameraViewport>(initialViewport);
  const resident = useRef(new Set<SurfaceInstanceId>()),
    pinned = useRef(new Set<SurfaceInstanceId>());
  const [viewport, setViewport] = useState(initialViewport),
    [portalElements, setPortalElements] = useState(
      new Map<SurfaceInstanceId, HTMLElement>(),
    );
  const [measureEpoch, setMeasureEpoch] = useState(0),
    [proxies, setProxies] = useState(
      new Map<SurfaceInstanceId, PaperProxy[]>(),
    );
  const paperGeometry = useMemo(
    () => paperGeometryForViewport(viewport),
    [viewport],
  );
  useLayoutEffect(() => {
    propsRef.current = props;
    viewportValue.current = viewport;
  }, [props, viewport]);
  const [desired, setDesired] = useState<SurfaceInstanceId[]>([]);
  useLayoutEffect(() => {
    const next = desiredFullText(props.surfaces, live.current, viewport, {
      resident: resident.current,
      pinned: new Set([
        ...pinned.current,
        ...(props.presentation.kind === "align-ranges"
          ? props.presentation.surfaces
          : []),
      ]),
    });
    setDesired((previous) =>
      previous.length === next.length &&
      previous.every((id, index) => id === next[index])
        ? previous
        : next,
    );
  }, [props.surfaces, props.view, props.presentation, viewport, measureEpoch]);
  const desiredIds = useMemo(() => new Set(desired), [desired]);
  useLayoutEffect(() => {
    resident.current = desiredIds;
  }, [desiredIds]);
  const onDemandSurfaces = props.onDemandSurfaces;
  useEffect(() => {
    onDemandSurfaces(desired);
  }, [desired, onDemandSurfaces]);
  const loaded = useMemo(
    () =>
      props.surfaces.flatMap((surface) =>
        surface.document && desiredIds.has(surface.surfaceId)
          ? [
              {
                surfaceId: surface.surfaceId,
                position: surface.position,
                document: surface.document,
              },
            ]
          : [],
      ),
    [props.surfaces, desiredIds],
  );
  const poseFor = useCallback(
    (value: SpaceView, id: SurfaceInstanceId) =>
      value.placements.get(id) ??
      defaultPaperPose(
        Math.max(
          0,
          propsRef.current.surfaces.findIndex(
            (surface) => surface.surfaceId === id,
          ),
        ),
      ),
    [],
  );
  const paint = useCallback(
    (value: SpaceView) => {
      live.current = value;
      runtime.current?.applyView(value, poseFor);
    },
    [poseFor],
  );
  const invalidate = useCallback(
    (id?: SurfaceInstanceId) => {
      geometry.current.invalidate(id);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const registerPassage = useCallback(
    (id: SurfaceInstanceId, handle: PassageHandle | null) => {
      if (handle) passages.current.set(id, handle);
      else {
        passages.current.delete(id);
        geometry.current.invalidate(id);
      }
    },
    [],
  );
  const registerAnchors = useCallback(
    (id: SurfaceInstanceId, value: readonly AnchorInput[]) => {
      anchors.current.set(id, value);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const hitTestAnchor = useCallback(
    (
      id: SurfaceInstanceId,
      anchor: AnchorInput,
      point: { x: number; y: number },
    ) => {
      const owner = geometry.current,
        layout = owner.layouts.get(id),
        root = viewportRef.current;
      const surface = propsRef.current.surfaces.find(
        (item) => item.surfaceId === id,
      );
      const scroll = nodes.current
        .get(id)
        ?.querySelector<HTMLElement>("[data-document-scroll]");
      if (
        !layout ||
        !scroll ||
        !root ||
        !surface ||
        surface.position.revisionId !== anchor.revisionId
      )
        return false;
      const rect = root.getBoundingClientRect();
      const hit = runtime.current?.hitPaper(
        id,
        screenPoint(point.x - rect.left, point.y - rect.top),
      );
      const cached = owner.resolveAnchor(id, anchor, undefined, scroll, false);
      return (
        !!hit &&
        !!cached &&
        visibleAnchorFragments(cached, layout, scroll).some(
          (part) =>
            hit.x >= part.left &&
            hit.x <= part.right &&
            hit.y >= part.top &&
            hit.y <= part.bottom,
        )
      );
    },
    [],
  );
  const focus = useCallback((id: SurfaceInstanceId) => {
    if (!interaction.current.consumeClick() && live.current.focus !== id)
      propsRef.current.onFocusSurface(id);
  }, []);

  useLayoutEffect(() => {
    const node = viewportRef.current,
      background = backgroundRef.current,
      host = rendererHostRef.current;
    if (!node || !background || !host) return;
    const owner = interaction.current;
    const scene = new ThreeSceneRuntime(host, background, {
      start: () => owner.cameraStart(),
      change: (camera) => owner.cameraChange(camera),
      end: () => owner.cameraEnd(),
    });
    runtime.current = scene;
    owner.configure({
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
      grabPoint: (id, point) => {
        const local = scene.hitPaper(id, point);
        const shape = paperGeometryForViewport(viewportValue.current);
        return local
          ? paperToWorld(
              local,
              poseFor(live.current, id),
              shape.width,
              shape.height,
            )
          : null;
      },
      paint,
      checkpoint: (value) => propsRef.current.onViewCheckpoint(value),
      settled: () => setMeasureEpoch((epoch) => epoch + 1),
      stopPresentation: () => {},
      stopCameraInput: () => scene.cancelCameraInput(),
      cameraSnapshot: () => scene.cameraSnapshot(),
      setCameraEnabled: (enabled) => scene.setControlsEnabled(enabled),
      wheelCamera: (dx, dy, dolly, point) =>
        scene.wheelCamera(dx, dy, dolly, point),
    });
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.altKey || event.target === background)
        owner.wheel(event);
    };
    const blur = () => owner.finish();
    node.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("blur", blur);
    const resize = () => {
      const rect = node.getBoundingClientRect(),
        size = {
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        };
      viewportValue.current = size;
      scene.resize(size);
      setViewport(size);
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", wheel, true);
      window.removeEventListener("blur", blur);
      owner.dispose();
      scene.dispose();
      runtime.current = null;
    };
  }, [paint, poseFor, invalidate]);
  useLayoutEffect(() => {
    interaction.current.synchronize(props.view);
  }, [props.view, props.presentation.id, poseFor]);
  const fitted = useRef<{ key: string; camera: CameraPose } | null>(null);
  useLayoutEffect(() => {
    const key = `${props.presentation.id}:${props.view.focus}`;
    if (
      !props.view.focus ||
      (fitted.current?.key === key &&
        fitted.current.camera !== live.current.camera) ||
      props.presentation.kind === "restore"
    )
      return;
    const requested =
      props.presentation.kind === "align-ranges"
        ? props.presentation.surfaces
        : [props.view.focus];
    const papers = [...new Set(requested)]
      .filter((id) => live.current.placements.has(id))
      .map((id) => ({ pose: poseFor(live.current, id), ...paperGeometry }));
    const camera = focusCamera(
      live.current.camera,
      poseFor(live.current, props.view.focus),
    );
    const view = {
      ...live.current,
      camera:
        papers.length > 1
          ? fitCameraToPapers(camera, papers, viewport)
          : fitCameraToPaper(
              camera,
              paperGeometry.width,
              paperGeometry.height,
              viewport,
            ),
    };
    fitted.current = { key, camera: view.camera };
    paint(view);
    propsRef.current.onViewCheckpoint({
      generation: props.presentation.id,
      view,
    });
  }, [
    props.presentation,
    props.view.focus,
    viewport,
    paperGeometry,
    paint,
    poseFor,
  ]);
  useLayoutEffect(() => {
    const scene = runtime.current;
    if (!scene) return;
    const changed = scene.setPapers(
      props.surfaces.map((surface) => ({
        surfaceId: surface.surfaceId,
        geometry: paperGeometry,
        pose: poseFor(live.current, surface.surfaceId),
      })),
    );
    nodes.current = scene.paperElements;
    if (changed) {
      setPortalElements(new Map(scene.paperElements));
      invalidate();
    }
  }, [props.surfaces, paperGeometry, poseFor, invalidate]);
  useEffect(() => {
    const fonts = document.fonts,
      changed = () => invalidate();
    const selection = () => {
      const selected = window.getSelection(),
        next = new Set<SurfaceInstanceId>();
      if (selected && !selected.isCollapsed)
        for (const node of [selected.anchorNode, selected.focusNode]) {
          const element = node instanceof Element ? node : node?.parentElement;
          const paper = element?.closest<HTMLElement>("[data-surface-key]");
          if (paper && viewportRef.current?.contains(paper))
            next.add(paper.dataset.surfaceKey as SurfaceInstanceId);
        }
      if ([...next].join() !== [...pinned.current].join()) {
        pinned.current = next;
        setMeasureEpoch((epoch) => epoch + 1);
      }
    };
    fonts.addEventListener("loadingdone", changed);
    document.addEventListener("selectionchange", selection);
    return () => {
      fonts.removeEventListener("loadingdone", changed);
      document.removeEventListener("selectionchange", selection);
    };
  }, [invalidate]);
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
    const scene = runtime.current,
      owner = geometry.current;
    if (!scene || !portalElements.size) return;
    for (const surface of props.surfaces)
      owner.setSurfaceContext(
        surface.surfaceId,
        JSON.stringify([
          desiredIds.has(surface.surfaceId),
          surface.position.documentId,
          surface.position.revisionId,
        ]),
      );
    for (const surface of loaded) {
      const required = [...(anchors.current.get(surface.surfaceId) ?? [])];
      if (surface.position.focus) required.push(surface.position.focus);
      for (const binding of props.bindings)
        for (const endpoint of [binding.from, binding.to])
          if (endpoint.surfaceId === surface.surfaceId)
            required.push(endpoint.anchor);
      if (
        required.some((anchor) => !owner.hasAnchor(surface.surfaceId, anchor))
      )
        owner.dirty = true;
    }
    for (const id of restored.current.keys())
      if (!loaded.some((surface) => surface.surfaceId === id))
        restored.current.delete(id);
    const measure = owner.dirty,
      restore = measure
        ? owner.measureLayout(scene.measurementRoot, nodes.current)
        : () => {};
    const bands: SceneBand[] = [],
      markers = new Map<SurfaceInstanceId, PaperProxy[]>();
    try {
      for (const surface of loaded) {
        const scroll = nodes.current
          .get(surface.surfaceId)
          ?.querySelector<HTMLElement>("[data-document-scroll]");
        if (!scroll) continue;
        const key = `${surface.document.revisionId}:${props.presentation.id}`;
        if (restored.current.get(surface.surfaceId) !== key) {
          scroll.scrollTop = surface.position.scrollTop;
          const anchor = surface.position.focus;
          if (
            anchor &&
            props.presentation.kind === "align-ranges" &&
            props.presentation.surfaces.includes(surface.surfaceId)
          ) {
            const resolved = owner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
            if (resolved?.fragments.length)
              scroll.scrollTop = rangeScrollTarget(
                Math.min(...resolved.fragments.map((r) => r.top)),
                Math.max(...resolved.fragments.map((r) => r.bottom)),
                resolved.coverage === "complete",
                scroll.clientHeight,
                scroll.scrollHeight - scroll.clientHeight,
              );
          }
          restored.current.set(surface.surfaceId, key);
        }
        for (const anchor of anchors.current.get(surface.surfaceId) ?? [])
          if (anchor.revisionId === surface.position.revisionId)
            owner.resolveAnchor(
              surface.surfaceId,
              anchor,
              passages.current.get(surface.surfaceId),
              scroll,
              measure,
            );
      }
      const byId = new Map(
        props.surfaces.map((surface) => [surface.surfaceId, surface]),
      );
      const bindings = new Map(
        props.bindings.map((binding) => [binding.connectionId, binding]),
      );
      for (const connection of props.connections) {
        const binding = bindings.get(connection.id);
        if (!binding) continue;
        const mouths = (["from", "to"] as const).map((endpoint) => {
          const bound = binding[endpoint],
            opposite = binding[endpoint === "from" ? "to" : "from"];
          const surface = byId.get(bound.surfaceId),
            other = byId.get(opposite.surfaceId),
            declared = connection[endpoint],
            anchor = bound.anchor;
          if (
            !surface ||
            !other ||
            anchor.revisionId !== surface.position.revisionId ||
            declared.documentId !== surface.position.documentId ||
            anchor.revisionId !== declared.revisionId ||
            anchor.start !== declared.start ||
            anchor.end !== declared.end
          )
            return null;
          const id = surface.surfaceId,
            pose = poseFor(live.current, id),
            otherPose = poseFor(live.current, other.surfaceId);
          const direction = toThreeWorld(otherPose.position)
            .sub(toThreeWorld(pose.position))
            .applyQuaternion(toThreeQuaternion(pose.orientation).invert());
          const edge =
            Math.abs(direction.x) >= Math.abs(direction.y)
              ? direction.x >= 0
                ? "right"
                : "left"
              : direction.y <= 0
                ? "bottom"
                : "top";
          const scroll = nodes.current
            .get(id)
            ?.querySelector<HTMLElement>("[data-document-scroll]");
          const mouth = resolvePassageMouth({
            surfaceId: id,
            anchor,
            edge,
            layout: owner.layouts.get(id),
            geometry: owner.resolveAnchor(
              id,
              anchor,
              passages.current.get(id),
              scroll,
              measure,
            ),
            scroll,
            availability:
              surface.payload !== "ready"
                ? surface.payload
                : desiredIds.has(id)
                  ? "ready"
                  : "unmounted",
          });
          if (mouth.precision !== "exact") {
            const list = markers.get(id) ?? [];
            list.push({
              key: `${connection.id}:${endpoint}`,
              mouth,
              color: relationStyle(connection.relation)["--relation-signal"],
            });
            markers.set(id, list);
          }
          return mouth;
        });
        if (mouths[0] && mouths[1])
          bands.push({
            id: connection.id,
            from: mouths[0],
            to: mouths[1],
            color: relationStyle(connection.relation)["--relation-signal"],
            opacity: props.selectedConnectionId
              ? connection.id === props.selectedConnectionId
                ? 0.42
                : 0.045
              : mouths.every((mouth) => mouth?.precision === "exact")
                ? 0.24
                : 0.09,
          });
      }
    } finally {
      restore();
      owner.dirty = false;
    }
    scene.setBands(bands);
    setProxies(markers);
  }, [
    loaded,
    desiredIds,
    props.surfaces,
    props.connections,
    props.selectedConnectionId,
    props.bindings,
    props.presentation,
    measureEpoch,
    portalElements,
    poseFor,
  ]);
  const scroll = useCallback(
    (id: SurfaceInstanceId, top: number) => {
      propsRef.current.onScroll(id, top, propsRef.current.presentation.id);
      setMeasureEpoch((epoch) => epoch + 1);
    },
    [setMeasureEpoch],
  );
  const pointerStart = useRef<{
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const framePapers = (all: boolean) => {
    interaction.current.finish();
    const value = live.current;
    const ids =
      all || !value.focus
        ? props.surfaces.map((surface) => surface.surfaceId)
        : [value.focus];
    if (!ids.length) return;
    const camera = focusCamera(
      value.camera,
      poseFor(value, value.focus ?? ids[0]),
    );
    const view = {
      ...value,
      camera: fitCameraToPapers(
        camera,
        ids.map((id) => ({ pose: poseFor(value, id), ...paperGeometry })),
        viewport,
      ),
    };
    paint(view);
    props.onViewCheckpoint({ generation: props.presentation.id, view });
    setMeasureEpoch((epoch) => epoch + 1);
  };
  return (
    <div
      ref={viewportRef}
      className="spatial-scene"
      data-hit-role="stage"
      aria-label="三维文档空间"
      role="region"
      tabIndex={0}
      onPointerDownCapture={(event) => {
        interaction.current.beginPointer();
        pointerStart.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        const target = event.target as Element;
        if (
          target !== backgroundRef.current &&
          !target.closest(
            "button,a,input,textarea,select,summary,[contenteditable]",
          ) &&
          (event.button === 2 ||
            (event.button === 0 &&
              event.shiftKey &&
              !target.closest("[data-paper-grip]")))
        ) {
          event.preventDefault();
          event.stopPropagation();
          runtime.current?.beginCameraPointer(event.nativeEvent);
        }
      }}
      onPointerMoveCapture={(event) => {
        const start = pointerStart.current;
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5
        )
          start.moved = true;
      }}
      onPointerDown={(event) => interaction.current.pointerDown(event)}
      onPointerMove={(event) => interaction.current.pointerMove(event)}
      onPointerUp={(event) => interaction.current.pointerUp(event)}
      onPointerCancelCapture={() => interaction.current.finish()}
      onLostPointerCapture={(event) =>
        interaction.current.lostPointerCapture(event)
      }
      onClickCapture={(event) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        const dragged = interaction.current.consumeClick();
        if (event.detail === 0) return;
        if (
          dragged ||
          start?.moved ||
          (start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          !start ||
          event.defaultPrevented ||
          window.getSelection()?.isCollapsed === false
        )
          return;
        if (
          (event.target as Element).closest(
            "button,a,input,textarea,[data-paper-grip]",
          )
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const hit = runtime.current?.pickBand(
          screenPoint(event.clientX - rect.left, event.clientY - rect.top),
        );
        if (!hit) return;
        const binding = props.bindings.find(
          (item) => item.connectionId === hit.connectionId,
        );
        if (!binding) return;
        event.preventDefault();
        event.stopPropagation();
        props.onFollow({
          connectionId: hit.connectionId,
          origin: {
            kind: "surface",
            surfaceId: binding[hit.endpoint].surfaceId,
            endpoint: hit.endpoint,
          },
        });
      }}
      onKeyDown={(event) => {
        if (interaction.current.keyDown(event)) return;
        if (event.key === "Home" && event.target === event.currentTarget) {
          event.preventDefault();
          framePapers(false);
          return;
        }
      }}
    >
      <div
        ref={backgroundRef}
        className="spatial-scene-background"
        data-scene-background
      />
      <div ref={rendererHostRef} className="spatial-renderers" />
      {props.surfaces.map((surface) => {
        const element = portalElements.get(surface.surfaceId);
        return element ? (
          <ScenePaper
            key={surface.surfaceId}
            surface={surface}
            resident={desiredIds.has(surface.surfaceId)}
            element={element}
            proxies={proxies.get(surface.surfaceId) ?? []}
            onRetry={props.onRetrySurface}
            registerPassage={registerPassage}
            invalidate={invalidate}
            registerAnchors={registerAnchors}
            hitTestAnchor={hitTestAnchor}
            onScroll={scroll}
            onFocus={focus}
            renderDocument={props.renderDocument}
            renderDocumentMenu={props.renderDocumentMenu}
          />
        ) : null;
      })}
      <nav className="spatial-navigation" aria-label="空间导航">
        <button type="button" onClick={() => framePapers(false)}>
          定位文档
        </button>
        <button type="button" onClick={() => framePapers(true)}>
          查看全部
        </button>
      </nav>
      <details className="spatial-help">
        <summary>操作说明</summary>
        <p>
          拖动空白处平移；Shift 或右键拖动环顾；捏合或 Alt
          滚轮缩放。正文内滚动阅读、拖动选择文字；拖动标题或纸边移动文档，按住
          Shift 调整远近。按 Escape
          取消当前操作。触屏可单指平移空白处，双指缩放。
        </p>
      </details>
      {props.relationNavigation.total > 0 && (
        <nav className="spatial-relations" aria-label="关联导航">
          <button
            type="button"
            aria-label="上一个关联"
            disabled={
              !props.relationNavigation.canPrevious ||
              props.relationNavigation.loading
            }
            onClick={() => props.onStepConnection(-1)}
          >
            ←
          </button>
          <span aria-live="polite">
            关联 {props.relationNavigation.ordinal ?? "—"} /{" "}
            {props.relationNavigation.total}
          </span>
          <button
            type="button"
            aria-label="下一个关联"
            disabled={
              !props.relationNavigation.canNext ||
              props.relationNavigation.loading
            }
            onClick={() => props.onStepConnection(1)}
          >
            →
          </button>
        </nav>
      )}
    </div>
  );
}
