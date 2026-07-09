import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  absPoints,
  boundsCenter,
  boundsIntersect,
  boundsUnion,
  clampCornerRadius,
  distToSegment,
  findBindTarget,
  frameTitleHitTest,
  getAABB,
  getBounds,
  hitTest,
  lassoCaptures,
  normalizeRect,
  pointInBounds,
  pointInPolygon,
  rotatePoint,
  rotationRad,
  toLocalPoint,
  updateBoundArrows,
} from './geometry';
import type { Bounds } from './geometry';
import { contrastTextColor } from './ColorPicker';
import { cloneElements, expandWithGroups, freeFramePosition, nextName, removeElements, withFrameContents } from './elementOps';
import { Icons } from './Icons';
import {
  LINE_HEIGHT,
  ensureTextFits,
  hugBoxedTextHeight,
  textColorOf,
  getTextArea,
  isTextContainer,
  measureText,
  clipFrameFor,
  elementOutlinePath,
  getImage,
  maskShapePath,
  pageRenderBox,
  renderElement,
  renderElementClipped,
  renderPageContents,
  textBlockHeight,
  wrapText,
} from './render';
import { FONT_FAMILY, isInfinitePage, pageSize, randomSeed, uid } from './types';
import type { Doc, Point, SketchElement, StyleDefaults, Tool } from './types';

const ACCENT = '#4dabf7';

// Corner-specific rotate cursors (Fix 1.45.1): a single arc with arrowheads
// at both ends, oriented to wrap the hovered corner; white halo for
// visibility. Base art wraps the top-left (nw) corner.
const rotateCursorSvg = (deg: number) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">' +
  `<g transform="rotate(${deg} 12 12)">` +
  '<g fill="none" stroke="white" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12a8 8 0 0 1 8-8"/><path d="M8.9 1.6L12.8 4l-3 2.9"/><path d="M1.6 8.9L4 12.8l2.9-3"/></g>' +
  '<g fill="none" stroke="black" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12a8 8 0 0 1 8-8"/><path d="M8.9 1.6L12.8 4l-3 2.9"/><path d="M1.6 8.9L4 12.8l2.9-3"/></g></g></svg>';
type RotCorner = 'nw' | 'ne' | 'sw' | 'se';
const ROTATE_CURSORS: Record<RotCorner, string> = {
  nw: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(rotateCursorSvg(0))}") 11 11, alias`,
  ne: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(rotateCursorSvg(90))}") 11 11, alias`,
  se: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(rotateCursorSvg(180))}") 11 11, alias`,
  sw: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(rotateCursorSvg(270))}") 11 11, alias`,
};
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const HANDLE_SCREEN_SIZE = 8;
const RULER = 22; // px thickness of the top/left measurement rulers

/** Common artboard sizes for the frame tool (Fix 1.17 §3). */
const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'Mobile', w: 390, h: 844 },
  { label: 'Android', w: 360, h: 800 },
  { label: 'Large Mobile', w: 430, h: 932 },
  { label: 'Tablet', w: 768, h: 1024 },
  { label: 'Tablet Landscape', w: 1024, h: 768 },
  { label: 'Desktop', w: 1440, h: 1024 },
  { label: 'Full HD', w: 1920, h: 1080 },
  { label: 'Instagram Post', w: 1080, h: 1080 },
  { label: 'Instagram Story', w: 1080, h: 1920 },
  { label: '16:9 Slide', w: 1920, h: 1080 },
  { label: 'A4 Portrait', w: 794, h: 1123 },
  { label: 'A4 Landscape', w: 1123, h: 794 },
];

export interface CanvasHandle {
  startCrop: (id: string) => void;
  fit: () => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  startTextEdit: (id: string) => void;
}

interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

type Action =
  | {
      type: 'pan';
      startX: number;
      startY: number;
      origView: ViewState;
      /** Right-button pan (Fix 1.27): engages past a drag threshold so a plain
       * right-click can still open the context menu on release. */
      rightBtn?: boolean;
      moved?: boolean;
    }
  | { type: 'draw'; id: string; startX: number; startY: number; moved: boolean }
  | { type: 'draw-text'; id: string; startX: number; startY: number; moved: boolean }
  | { type: 'draw-linear'; id: string; startX: number; startY: number; moved: boolean }
  | { type: 'pencil'; id: string }
  | {
      type: 'move';
      startX: number;
      startY: number;
      origEls: SketchElement[];
      ids: Set<string>;
      moved: boolean;
      /** Alt+drag duplication: the moving elements are fresh clones. */
      isDup?: boolean;
      prevSelection?: string[];
    }
  | {
      type: 'resize';
      handle: Handle;
      origBounds: Bounds;
      origEls: SketchElement[];
      ids: Set<string>;
      /** Frame rotation (single rotated element): pointer is mapped into local space. */
      frameRot: number;
      frameCx: number;
      frameCy: number;
    }
  | { type: 'point-edit'; id: string; index: number }
  | {
      type: 'rotate';
      cx: number;
      cy: number;
      startAngle: number;
      origEls: SketchElement[];
      ids: Set<string>;
      single: boolean;
    }
  | { type: 'marquee'; startX: number; startY: number }
  | { type: 'erase'; changed: boolean }
  | { type: 'laser' }
  | { type: 'lasso'; points: Point[] }
  | { type: 'corner-radius'; id: string; origEl: SketchElement; cornerX: number; cornerY: number }
  | { type: 'crop-move'; id: string; orig: SketchElement; startLX: number; startLY: number }
  | { type: 'crop-scale'; id: string; orig: SketchElement; anchorX: number; anchorY: number; cornerX: number; cornerY: number }
  | { type: 'crop-rotate'; id: string; orig: SketchElement; cx: number; cy: number; startAngle: number }
  | { type: 'crop-frame'; id: string; orig: SketchElement; handle: Handle }
  | { type: 'bend-arrow'; id: string; origEl: SketchElement };

interface Editing {
  id: string;
  kind: 'text' | 'label';
  isNew: boolean;
  original: string;
}

interface Props {
  doc: Doc;
  /** Live accessor — always returns the latest document, even mid-event-handler. */
  getDoc: () => Doc;
  selection: string[];
  setSelection: (ids: string[]) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  defaults: StyleDefaults;
  /** Replace current page's elements. commit=true records an undo step. */
  updateElements: (els: SketchElement[], commit: boolean) => void;
  startGesture: () => void;
  endGesture: () => void;
  onZoomChange: (zoom: number) => void;
  onInsertImageFiles: (files: File[], at: Point | null) => void;
  onAddPage: () => void;
  /** Right-click frame menu actions; selection is already set to the frame. */
  onFrameMenuAction: (action: 'duplicate' | 'delete' | 'export-png' | 'export-pdf' | 'forward' | 'backward' | 'lock') => void;
  onMakeMask: () => void;
  /** Generic context-menu action dispatcher (Right Click fix): copy, paste,
   * duplicate, delete, lock, group, z-order, align, distribute, image
   * fit/fill/crop, link, zoom, add-element, font stepping. */
  onMenuAction: (action: string) => void;
  onReleaseMask: () => void;
  /** Dimensions-panel aspect-ratio lock: handle resizing stays proportional. */
  ratioLocked: boolean;
}

export const CanvasArea = forwardRef<CanvasHandle, Props>(function CanvasArea(props, ref) {
  const {
    doc,
    getDoc,
    selection,
    setSelection,
    tool,
    setTool,
    defaults,
    updateElements,
    startGesture,
    endGesture,
    onZoomChange,
    onInsertImageFiles,
    onAddPage,
    onFrameMenuAction,
    onMakeMask,
    onMenuAction,
    onReleaseMask,
    ratioLocked,
  } = props;

  const page = doc.pages[doc.currentPage];
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [view, setView] = useState<ViewState>({ zoom: 1, offsetX: 60, offsetY: 60 });
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const [bindHighlight, setBindHighlight] = useState<string | null>(null);
  // Frame under a dragged selection — highlighted as the drop target (Fix 1.37).
  const [dropFrame, setDropFrame] = useState<string | null>(null);
  // Smart alignment guides while dragging (Fix 1.41): page-space lines,
  // overlay-only — never saved or exported.
  const guidesRef = useRef<{
    v: { pos: number; a: number; b: number }[];
    h: { pos: number; a: number; b: number }[];
  } | null>(null);
  // Non-destructive image crop mode (Fix 1.43): id of the image being
  // crop-edited, or null.
  const [cropId, setCropId] = useState<string | null>(null);
  const cropIdRef = useRef<string | null>(null);
  cropIdRef.current = cropId;
  // Exit crop mode on Escape/Enter (capture-phase beats the app shortcuts),
  // on tool switch, and when the image leaves the selection.
  useEffect(() => {
    if (!cropId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        setCropId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cropId]);
  useEffect(() => {
    if (cropId && (tool !== 'select' || !selection.includes(cropId))) setCropId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selection]);

  /** The image content rect for crop mode; defaults to the element box. */
  const cropOf = (el: SketchElement) => el.crop ?? { x: 0, y: 0, w: el.width, h: el.height };

  const cropRotRad = (c: { rotation?: number }) => (((c.rotation ?? 0) % 360) * Math.PI) / 180;

  /** Content-rect corners in element-local space (TL, TR, BL, BR), honoring
   * the content's own rotation (Fix 1.45.1). */
  const cropContentCorners = (
    el: SketchElement,
    c: { x: number; y: number; w: number; h: number; rotation?: number }
  ): Point[] => {
    const pts: Point[] = [
      [el.x + c.x, el.y + c.y],
      [el.x + c.x + c.w, el.y + c.y],
      [el.x + c.x, el.y + c.y + c.h],
      [el.x + c.x + c.w, el.y + c.y + c.h],
    ];
    const rad = cropRotRad(c);
    if (!rad) return pts;
    const ctr: Point = [el.x + c.x + c.w / 2, el.y + c.y + c.h / 2];
    return pts.map((pt) => rotatePoint(pt, ctr, rad));
  };

  // Alt/Option held: measurement inspection mode (Fix 1.41/1.42).
  const [altHeld, setAltHeld] = useState(false);
  const altHeldRef = useRef(false);
  // Last pointer position in page coords; null once the cursor leaves the
  // canvas. Drives hover-target detection for Alt measurements.
  const pointerPageRef = useRef<Point | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altHeldRef.current = true;
        setAltHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altHeldRef.current = false;
        setAltHeld(false);
      }
    };
    const clear = () => {
      altHeldRef.current = false;
      setAltHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [cursor, setCursor] = useState('default');
  const [, setRedrawTick] = useState(0);

  const actionRef = useRef<Action | null>(null);
  const spaceDownRef = useRef(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [rotationDisplay, setRotationDisplay] = useState<{ deg: number; x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [linkTip, setLinkTip] = useState<{ x: number; y: number } | null>(null);
  type CtxItem =
    | 'div'
    | { label: string; run: () => void; danger?: boolean; disabled?: boolean; hint?: string };
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const [ctxActive, setCtxActive] = useState(-1);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const ctxMenuOpenRef = useRef(false);
  ctxMenuOpenRef.current = !!ctxMenu;
  // Placement + scroll lock (Right Click Size fix): measure the real menu,
  // keep it fully inside the viewport (16px margins, 40px bottom safe zone
  // for the Dock), center it when very tall, and lock body scrolling while
  // open — the menu itself may scroll internally.
  useLayoutEffect(() => {
    const el = ctxMenuRef.current;
    if (!ctxMenu || !el) return;
    const margin = 16;
    const bottomSafe = 40;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let x = ctxMenu.x;
    let y = ctxMenu.y;
    if (mh > vh * 0.8) {
      x = (vw - mw) / 2;
      y = (vh - Math.min(mh, vh - 32)) / 2;
    } else {
      if (x + mw > vw - margin) x = vw - mw - margin;
      if (y + mh > vh - bottomSafe) y = vh - mh - bottomSafe;
      if (x < margin) x = margin;
      if (y < margin) y = margin;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = 'visible';
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [ctxMenu]);
  // Keyboard navigation for the context menu (arrows / Enter / Escape).
  useEffect(() => {
    if (!ctxMenu) {
      setCtxActive(-1);
      return;
    }
    const enabled = ctxMenu.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it !== 'div' && !(it as { disabled?: boolean }).disabled);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setCtxMenu(null);
        return;
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        ev.stopPropagation();
        setCtxActive((cur) => {
          const pos = enabled.findIndex(({ i }) => i === cur);
          const next =
            ev.key === 'ArrowDown'
              ? enabled[(pos + 1) % enabled.length]
              : enabled[(pos - 1 + enabled.length) % enabled.length];
          return next ? next.i : -1;
        });
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        setCtxActive((cur) => {
          const item = ctxMenu.items[cur];
          if (item && item !== 'div') {
            setCtxMenu(null);
            (item as { run: () => void }).run();
          }
          return cur;
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ctxMenu]);
  // Close the menu when the tool changes.
  useEffect(() => {
    setCtxMenu(null);
  }, [tool]);

  /* ------------------------------ laser pointer ----------------------------- */

  const laserRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const laserRafRef = useRef(0);

  const tickLaser = useCallback(() => {
    const now = performance.now();
    laserRef.current = laserRef.current.filter((p) => now - p.t < 700);
    setRedrawTick((t) => t + 1);
    laserRafRef.current = laserRef.current.length ? requestAnimationFrame(tickLaser) : 0;
  }, []);

  const pushLaser = useCallback(
    (x: number, y: number) => {
      laserRef.current.push({ x, y, t: performance.now() });
      if (!laserRafRef.current) laserRafRef.current = requestAnimationFrame(tickLaser);
    },
    [tickLaser]
  );

  useEffect(() => () => cancelAnimationFrame(laserRafRef.current), []);
  const editingValueRef = useRef('');
  const editingCommittedRef = useRef(false);

  // Latest-value refs so pointer handlers never see stale state.
  const stateRef = useRef({ doc, selection, tool, defaults, view, editing, hoveredId, ratioLocked });
  stateRef.current = { doc, selection, tool, defaults, view, editing, hoveredId, ratioLocked };

  const getElements = () => {
    const d = getDoc();
    return d.pages[d.currentPage].elements;
  };

  /* ------------------------------ view helpers ------------------------------ */

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const d = getDoc();
    const p = d.pages[d.currentPage];
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    // Leave room for the rulers (top/left) and the floating bottom toolbar.
    const availW = cw - RULER - 90;
    const availH = ch - RULER - 150;
    // Infinite pages fit their content box (fresh 100% view when empty).
    const box = pageRenderBox(p);
    const zoom =
      isInfinitePage(p) && p.elements.length === 0
        ? 1
        : clampZoom(Math.min(availW / box.w, availH / box.h));
    setView({
      zoom,
      offsetX: RULER + 45 + (availW - box.w * zoom) / 2 - box.x * zoom,
      offsetY: RULER + 26 + (availH - box.h * zoom) / 2 - box.y * zoom,
    });
  }, []);

  const zoomAround = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const scale = zoom / v.zoom;
      return {
        zoom,
        offsetX: cx - (cx - v.offsetX) * scale,
        offsetY: cy - (cy - v.offsetY) * scale,
      };
    });
  }, []);

  useImperativeHandle(ref, () => ({
    startCrop: (id: string) => {
      setSelection([id]);
      setCropId(id);
    },
    fit,
    zoomBy: (factor: number) => {
      const c = containerRef.current;
      if (c) zoomAround(c.clientWidth / 2, c.clientHeight / 2, factor);
    },
    resetZoom: () => {
      setView((v) => ({ ...v, zoom: 1 }));
      fit();
      setView((v) => ({ ...v, zoom: Math.min(1, v.zoom) }));
    },
    startTextEdit: (id: string) => beginTextEdit(id, false),
  }));

  useEffect(() => {
    onZoomChange(view.zoom);
  }, [view.zoom, onZoomChange]);

  // Picking a drawing tool while editing text commits the edit (Fix 1.2 §17).
  // 'select' is excluded: newly created text switches the tool to select as
  // editing begins, and that transition must not immediately commit it.
  useEffect(() => {
    if (tool !== 'select' && stateRef.current.editing) {
      commitEditing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Refit when the visible page or its orientation changes.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.currentPage, page.orientation, page.id]);

  const toPage = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = stateRef.current.view;
    return [(clientX - rect.left - v.offsetX) / v.zoom, (clientY - rect.top - v.offsetY) / v.zoom];
  };

  /* --------------------------- selection utilities -------------------------- */

  const isInsideLockedFrame = (el: SketchElement, els: SketchElement[]): boolean => {
    if (el.type === 'frame' || !el.frameId) return false;
    return els.some((frame) => frame.id === el.frameId && frame.type === 'frame' && frame.locked);
  };

  /** Topmost frame whose bounds contain the page point (Fix 1.39: the
   * pointer decides frame membership while dragging/creating). */
  const frameAtPoint = (els: SketchElement[], x: number, y: number): SketchElement | null => {
    for (let i = els.length - 1; i >= 0; i--) {
      const f = els[i];
      if (f.type !== 'frame') continue;
      const [lx, ly] = toLocalPoint(f, x, y);
      if (pointInBounds(lx, ly, getBounds(f))) return f;
    }
    return null;
  };

  const unlockFrame = (id: string) => {
    const els = getElements();
    const frame = els.find((el) => el.id === id && el.type === 'frame' && el.locked);
    if (!frame) return;
    updateElements(els.map((el) => (el.id === id ? { ...el, locked: false } : el)), true);
    setSelection([id]);
    setCtxMenu(null);
  };

  /** Is the page point hidden by the element's clipping frame (Fix 1.37)?
   * Clipped-away parts are not clickable. */
  const hiddenByClip = (el: SketchElement, x: number, y: number, els: SketchElement[]): boolean => {
    const frame = clipFrameFor(el, els);
    if (!frame) return false;
    const [lx, ly] = toLocalPoint(frame, x, y);
    return !pointInBounds(lx, ly, getBounds(frame));
  };

  const selectableAt = (x: number, y: number): SketchElement | null => {
    const els = getElements();
    const threshold = 6 / stateRef.current.view.zoom;
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].locked) continue;
      if (isInsideLockedFrame(els[i], els)) continue;
      if (els[i].type === 'frame' && !frameTitleHitTest(els[i], x, y, threshold)) continue;
      if (hiddenByClip(els[i], x, y, els)) continue;
      if (hitTest(els[i], x, y, threshold)) return els[i];
    }
    return null;
  };

  const selectionBounds = (): Bounds | null => {
    const { selection: sel } = stateRef.current;
    const els = getElements().filter((e) => sel.includes(e.id));
    if (els.length === 0) return null;
    return boundsUnion(els.map(getBounds));
  };

  const singleLinearSelected = (): SketchElement | null => {
    const { selection: sel } = stateRef.current;
    if (sel.length !== 1) return null;
    const el = getElements().find((e) => e.id === sel[0]);
    return el && (el.type === 'line' || el.type === 'arrow') && el.points?.length === 2 ? el : null;
  };

  /**
   * The selection's editing frame: for a single element its unrotated local
   * bounds plus its rotation; for multi-selections the unrotated union of
   * rotated AABBs.
   */
  const selectionFrame = (): { b: Bounds; rot: number; single: SketchElement | null } | null => {
    const { selection: sel } = stateRef.current;
    const els = getElements().filter((e) => sel.includes(e.id));
    if (els.length === 0) return null;
    if (els.length === 1) {
      return { b: getBounds(els[0]), rot: rotationRad(els[0]), single: els[0] };
    }
    return { b: boundsUnion(els.map(getAABB)), rot: 0, single: null };
  };

  const toFrameLocal = (frame: { b: Bounds; rot: number }, px: number, py: number): Point => {
    if (!frame.rot) return [px, py];
    return rotatePoint([px, py], boundsCenter(frame.b), -frame.rot);
  };

  const handleAt = (clientX: number, clientY: number): Handle | null => {
    const frame = selectionFrame();
    if (!frame) return null;
    const v = stateRef.current.view;
    const [px, py] = toFrameLocal(frame, ...toPage(clientX, clientY));
    const r = HANDLE_SCREEN_SIZE / v.zoom;
    const positions = handlePositions(frame.b);
    const visibleHandles = stateRef.current.selection.length > 1 ? CORNER_HANDLES : HANDLES;
    for (const h of visibleHandles) {
      const [hx, hy] = positions[h];
      if (Math.abs(px - hx) <= r && Math.abs(py - hy) <= r) return h;
    }
    return null;
  };

  /** World position of the rotation handle: above the frame's top-center. */
  const rotateHandlePos = (frame: { b: Bounds; rot: number }): Point => {
    const zoom = stateRef.current.view.zoom;
    const local: Point = [frame.b.x + frame.b.w / 2, frame.b.y - 26 / zoom];
    return frame.rot ? rotatePoint(local, boundsCenter(frame.b), frame.rot) : local;
  };

  const rotateHandleAt = (clientX: number, clientY: number): boolean => {
    if (stateRef.current.selection.length !== 1) return false;
    const frame = selectionFrame();
    if (!frame) return false;
    const [px, py] = toPage(clientX, clientY);
    const [hx, hy] = rotateHandlePos(frame);
    return Math.hypot(px - hx, py - hy) <= 10 / stateRef.current.view.zoom;
  };

  /** Free-rotation zones just outside the selection's corners (Fix 1.45),
   * returning WHICH corner so the cursor can match it (Fix 1.45.1).
   * Resize handles, endpoints, and the stem handle always win. */
  const rotateZoneAt = (clientX: number, clientY: number): RotCorner | null => {
    const st = stateRef.current;
    if (st.tool !== 'select' || st.editing) return null;
    const CORNER_KEYS: RotCorner[] = ['nw', 'ne', 'sw', 'se'];
    const zone = 24 / st.view.zoom;

    // Crop/mask edit mode: zones ring the TRANSFORMED content corners so
    // rotation keeps working after every rotation (Fix 1.45.2) — never the
    // stale axis-aligned bounds. Points inside the content or mask still
    // drag/scale instead.
    if (cropIdRef.current) {
      const cel = getElements().find((x) => x.id === cropIdRef.current);
      if (!cel || cel.type !== 'image' || cel.locked) return null;
      const c = cropOf(cel);
      const eb = getBounds(cel);
      const rc = cropContentCorners(cel, c); // rotated TL, TR, BL, BR
      const [px, py] = toLocalPoint(cel, ...toPage(clientX, clientY));
      const insideContent = pointInPolygon(px, py, [rc[0], rc[1], rc[3], rc[2]]);
      const insideMask = pointInBounds(px, py, eb);
      if (insideContent || insideMask) return null;
      const ctr: Point = [cel.x + c.x + c.w / 2, cel.y + c.y + c.h / 2];
      for (let i = 0; i < 4; i++) {
        const d = Math.hypot(px - rc[i][0], py - rc[i][1]);
        if (d > 10 / st.view.zoom && d <= zone) {
          // Map the cursor by the corner's current VISUAL position.
          const world = cel.rotation
            ? rotatePoint(rc[i], boundsCenter(eb), rotationRad(cel))
            : rc[i];
          const wctr = cel.rotation
            ? rotatePoint(ctr, boundsCenter(eb), rotationRad(cel))
            : ctr;
          return world[0] < wctr[0]
            ? world[1] < wctr[1] ? 'nw' : 'sw'
            : world[1] < wctr[1] ? 'ne' : 'se';
        }
      }
      return null;
    }

    const frame = selectionFrame();
    if (!frame) return null;
    const els = getElements().filter((e) => st.selection.includes(e.id) && !e.locked);
    if (els.length === 0) return null;
    if (handleAt(clientX, clientY)) return null;
    if (rotateHandleAt(clientX, clientY)) return null;
    if (endpointAt(clientX, clientY) !== null) return null;
    const [px, py] = toFrameLocal(frame, ...toPage(clientX, clientY));
    const b = frame.b;
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return null;
    const corners: Point[] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(px - corners[i][0], py - corners[i][1]) <= zone) {
        if (!frame.rot) return CORNER_KEYS[i];
        // Rotated selection: pick the icon by the corner's visual position.
        const ctr = boundsCenter(b);
        const world = rotatePoint(corners[i], ctr, frame.rot);
        const wctr = rotatePoint(ctr, ctr, frame.rot);
        return world[0] < wctr[0]
          ? world[1] < wctr[1] ? 'nw' : 'sw'
          : world[1] < wctr[1] ? 'ne' : 'se';
      }
    }
    return null;
  };

  /** Badge shown on linked elements (selected or hovered): AABB top-right corner. */
  const linkBadgeCenter = (el: SketchElement): Point => {
    const bb = getAABB(el);
    const zoom = stateRef.current.view.zoom;
    return [bb.x + bb.w + 10 / zoom, bb.y - 10 / zoom];
  };

  const linkBadgeAt = (px: number, py: number): SketchElement | null => {
    const els = getElements();
    const { selection: sel } = stateRef.current;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.link) continue;
      if (!sel.includes(el.id) && el.id !== stateRef.current.hoveredId) continue;
      const [bx, by] = linkBadgeCenter(el);
      if (Math.hypot(px - bx, py - by) <= 11 / stateRef.current.view.zoom) return el;
    }
    return null;
  };

  const endpointAt = (clientX: number, clientY: number): number | null => {
    const el = singleLinearSelected();
    if (!el) return null;
    const v = stateRef.current.view;
    const [px, py] = toPage(clientX, clientY);
    const pts = absPoints(el);
    const r = 10 / v.zoom;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(px - pts[i][0], py - pts[i][1]) <= r) return i;
    }
    return null;
  };

  /* ----------------------- corner-radius / bend handles ---------------------- */

  /** World position of the corner-radius drag handle on a shape. */
  /** Extra inset that keeps the triangle's radius dot inside the shape. */
  const TRIANGLE_CR_INSET = 22;
  const RECTANGLE_CR_INSET = 12;

  /** The radius-capable shape behind an element: plain shapes, or the mask
   * shape of a clipped image (Clipmask Fix 1.0). */
  const radiusShapeOf = (
    el: SketchElement
  ): { shape: 'rectangle' | 'diamond' | 'triangle'; cr: number } | null => {
    if (el.type === 'rectangle' || el.type === 'diamond' || el.type === 'triangle') {
      return { shape: el.type, cr: el.cornerRadius ?? 0 };
    }
    if (el.type === 'image' && el.mask && el.mask.type !== 'ellipse') {
      return { shape: el.mask.type, cr: el.mask.cornerRadius ?? 0 };
    }
    return null;
  };

  const cornerRadiusHandlePos = (el: SketchElement): Point | null => {
    const spec = radiusShapeOf(el);
    if (!spec) return null;
    const b = getBounds(el);
    const cr = clampCornerRadius(spec.cr, b.w, b.h);
    // Place the dot at the top-left rounded corner offset.
    if (spec.shape === 'rectangle') {
      return [b.x + cr + RECTANGLE_CR_INSET, b.y + cr + RECTANGLE_CR_INSET];
    }
    if (spec.shape === 'triangle') {
      // One internal dot, centered under the apex (Fix 1.26).
      return [b.x + b.w / 2, b.y + TRIANGLE_CR_INSET + cr];
    }
    // Diamond: place near the top vertex, offset inward.
    return [b.x + b.w / 2, b.y + cr];
  };

  const cornerRadiusHandleAt = (clientX: number, clientY: number): SketchElement | null => {
    const { selection: sel } = stateRef.current;
    if (sel.length !== 1) return null;
    const el = getElements().find((e) => e.id === sel[0]);
    if (!el || !radiusShapeOf(el)) return null;
    const pos = cornerRadiusHandlePos(el);
    if (!pos) return null;
    const [px, py] = toPage(clientX, clientY);
    // Transform into local space if rotated.
    const [lx, ly] = el.rotation
      ? rotatePoint([px, py], boundsCenter(getBounds(el)), -rotationRad(el))
      : [px, py];
    if (Math.hypot(lx - pos[0], ly - pos[1]) <= 10 / stateRef.current.view.zoom) return el;
    return null;
  };

  /**
   * World position of the arrow-bend handle. The handle always sits ON the
   * visible path: for curved arrows it is the Bézier point at t=0.5, never
   * the raw control point (which can float far away from the curve).
   */
  const bendHandlePos = (el: SketchElement): Point | null => {
    if ((el.type !== 'arrow' && el.type !== 'line') || !el.points || el.points.length !== 2) return null;
    const pts = absPoints(el);
    if (el.controlPoint) {
      const cx = el.x + el.controlPoint[0];
      const cy = el.y + el.controlPoint[1];
      return [
        0.25 * pts[0][0] + 0.5 * cx + 0.25 * pts[1][0],
        0.25 * pts[0][1] + 0.5 * cy + 0.25 * pts[1][1],
      ];
    }
    return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  };

  const bendHandleAt = (clientX: number, clientY: number): SketchElement | null => {
    const { selection: sel } = stateRef.current;
    if (sel.length !== 1) return null;
    const el = getElements().find((e) => e.id === sel[0]);
    if (!el || (el.type !== 'arrow' && el.type !== 'line') || !el.points || el.points.length !== 2) return null;
    const pos = bendHandlePos(el);
    if (!pos) return null;
    const [px, py] = toPage(clientX, clientY);
    if (Math.hypot(px - pos[0], py - pos[1]) <= 10 / stateRef.current.view.zoom) return el;
    return null;
  };

  /* ------------------------------ text editing ------------------------------ */

  const beginTextEdit = (id: string, isNew: boolean, kind: 'text' | 'label' = 'text') => {
    const el = getElements().find((e) => e.id === id);
    if (!el || el.locked) return;
    // The whole edit (including live content-hugging updates while typing)
    // lives in one gesture: exactly one undo step per edit session.
    startGesture();
    const original = kind === 'label' ? (el.label ?? '') : (el.text ?? '');
    editingValueRef.current = original;
    editingCommittedRef.current = false;
    setEditing({ id, kind, isNew, original });
    setSelection([id]);
  };

  const commitEditing = () => {
    const ed = stateRef.current.editing;
    if (!ed || editingCommittedRef.current) return;
    editingCommittedRef.current = true;
    const value = editingValueRef.current;
    const els = getElements();
    const el = els.find((e) => e.id === ed.id);
    setEditing(null);

    if (!el) {
      endGesture();
      return;
    }
    if (ed.kind === 'label') {
      const trimmed = value.trim();
      // Frames must keep a non-empty name (Fix 1.18 §3).
      const finalLabel = el.type === 'frame' && trimmed === '' ? ed.original : trimmed;
      if (finalLabel !== ed.original) {
        updateElements(
          els.map((e) => (e.id === ed.id ? { ...e, label: finalLabel } : e)),
          false
        );
      }
      endGesture();
      return;
    }
    // Text elements disappear when left empty (no orphan empty layers).
    if (el.type === 'text' && value.trim() === '') {
      updateElements(removeElements(els, new Set([ed.id])), false);
      endGesture(); // for new elements the gesture nets to nothing → no history entry
      setSelection([]);
      return;
    }
    let next = els.map((e) => {
      if (e.id !== ed.id) return e;
      if (e.type === 'text') {
        if (e.boxed) {
          // Fixed-width box: height hugs the wrapped content exactly.
          const updated = { ...e, text: value };
          return { ...updated, height: hugBoxedTextHeight(updated) };
        }
        const { w, h } = measureText(value, e.fontSize ?? 20);
        return { ...e, text: value, width: w, height: h };
      }
      if (isTextContainer(e)) {
        // Contained shape text: empty clears it; otherwise center by default
        // and auto-grow the shape if the text no longer fits.
        if (value.trim() === '') {
          return { ...e, text: undefined };
        }
        const auto = e.autoTextContrast !== false;
        return ensureTextFits({
          ...e,
          text: value,
          fontSize: e.fontSize ?? 16,
          textAlign: e.textAlign ?? 'center',
          textColor: auto ? contrastTextColor(e.fillColor) : e.textColor,
        });
      }
      if (e.type === 'sticky') {
        const auto = e.autoTextContrast !== false;
        return { ...e, text: value, textColor: auto ? contrastTextColor(e.fillColor) : e.textColor };
      }
      return { ...e, text: value };
    });
    next = updateBoundArrows(next);
    updateElements(next, false);
    endGesture(); // one undo step for the whole edit session
  };

  /* ------------------------------ element create ---------------------------- */

  const baseElement = (type: SketchElement['type'], x: number, y: number): SketchElement => {
    const d = stateRef.current.defaults;
    // Linear elements must stay visible: "no stroke" does not apply to them.
    const needsStroke = type === 'line' || type === 'arrow' || type === 'freedraw';
    return {
      id: uid(),
      type,
      x,
      y,
      width: 0,
      height: 0,
      frameId: type === 'frame' ? null : frameAtPoint(getElements(), x, y)?.id ?? null,
      arrowHead: type === 'arrow' ? d.arrowHead ?? 'end' : undefined,
      strokeColor: needsStroke && d.strokeColor === 'transparent' ? '#1e1e1e' : d.strokeColor,
      fillColor: type === 'sticky' ? d.stickyColor : d.fillColor,
      strokeWidth: d.strokeWidth,
      strokeStyle: d.strokeStyle,
      opacity: d.opacity,
      seed: randomSeed(),
      locked: false,
      groupId: null,
    };
  };

  /* -------------------------------- web embed -------------------------------- */

  // Reset the link field whenever the embed prompt opens.
  useEffect(() => {
    if (tool === 'embed') setEmbedUrl('');
  }, [tool]);

  const createEmbed = () => {
    const raw = embedUrl.trim();
    if (!raw) {
      setTool('select');
      return;
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const d = getDoc();
    const { w: pw, h: ph } = pageSize(d.pages[d.currentPage]);
    const width = 320;
    const height = 220;
    const el = baseElement('embed', pw / 2 - width / 2, ph / 2 - height / 2);
    el.width = width;
    el.height = height;
    el.url = url;
    startGesture();
    updateElements([...getElements(), el], false);
    endGesture();
    setSelection([el.id]);
    setTool('select');
  };

  /* --------------------------------- frames ---------------------------------- */

  const createPresetFrame = (fp: { label: string; w: number; h: number }) => {
    const els = getElements();
    const v = stateRef.current.view;
    const container = containerRef.current;
    // Start near the viewport center; dodge existing frames.
    const cx = container ? (container.clientWidth / 2 - v.offsetX) / v.zoom : 200;
    const cy = container ? (container.clientHeight / 2 - v.offsetY) / v.zoom : 200;
    const frames = els.filter((el) => el.type === 'frame');
    let x = cx - fp.w / 2;
    let y = cy - fp.h / 2;
    if (frames.length > 0) {
      const last = frames[frames.length - 1];
      [x, y] = freeFramePosition(els, getBounds(last), fp.w, fp.h);
    }
    const el = baseElement('frame', x, y);
    el.width = fp.w;
    el.height = fp.h;
    el.fillColor = '#ffffff';
    el.strokeColor = '#b9bcc7';
    el.strokeWidth = 1;
    el.strokeStyle = 'solid';
    el.label = nextName(fp.label, frames.map((f) => f.label ?? ''));
    startGesture();
    updateElements([el, ...els], false);
    endGesture();
    setSelection([el.id]);
    setTool('select');
  };

  /** Pan minimally so the given page-space rect is visible in the viewport. */
  const ensureVisible = (b: Bounds) => {
    const container = containerRef.current;
    if (!container) return;
    const v = stateRef.current.view;
    const pad = 40;
    const x1 = b.x * v.zoom + v.offsetX;
    const y1 = b.y * v.zoom + v.offsetY;
    const x2 = (b.x + b.w) * v.zoom + v.offsetX;
    const y2 = (b.y + b.h) * v.zoom + v.offsetY;
    let dx = 0;
    let dy = 0;
    if (x2 > container.clientWidth - pad) dx = container.clientWidth - pad - x2;
    if (x1 + dx < RULER + pad) dx = RULER + pad - x1;
    if (y2 > container.clientHeight - 90) dy = container.clientHeight - 90 - y2;
    if (y1 + dy < RULER + pad) dy = RULER + pad - y1;
    if (dx || dy) setView((prev) => ({ ...prev, offsetX: prev.offsetX + dx, offsetY: prev.offsetY + dy }));
  };

  type FrameDir = 'top' | 'bottom' | 'left' | 'right';

  /**
   * Create a frame in the given direction from `frame` (Fix 1.20): blank and
   * matching by default, a full duplicate with contents when Alt is held.
   * Occupied slots step further along the same direction.
   */
  const addFrameDirectional = (frame: SketchElement, dir: FrameDir, withContents: boolean) => {
    const els = getElements();
    const fb = getBounds(frame);
    const GAP = 100;
    const slot = (i: number): Point => {
      switch (dir) {
        case 'right':
          return [fb.x + (fb.w + GAP) * i, fb.y];
        case 'left':
          return [fb.x - (fb.w + GAP) * i, fb.y];
        case 'bottom':
          return [fb.x, fb.y + (fb.h + GAP) * i];
        case 'top':
          return [fb.x, fb.y - (fb.h + GAP) * i];
      }
    };
    const frames = els.filter((e) => e.type === 'frame');
    const occupied = (x: number, y: number) =>
      frames.some((f) => {
        const o = getBounds(f);
        return x < o.x + o.w + 40 && x + fb.w > o.x - 40 && y < o.y + o.h + 40 && y + fb.h > o.y - 40;
      });
    let pos = slot(1);
    for (let i = 2; occupied(pos[0], pos[1]) && i < 50; i++) pos = slot(i);

    const frameNames = frames.map((f) => f.label ?? '');
    startGesture();
    let newFrameId: string;
    if (withContents) {
      const idSet = withFrameContents(els, [frame.id]);
      const source = els.filter((e) => idSet.has(e.id) && !e.locked);
      let clones = cloneElements(source, pos[0] - fb.x, pos[1] - fb.y);
      clones = clones.map((c) =>
        c.type === 'frame' ? { ...c, label: nextName(frame.label || 'Frame', frameNames) } : c
      );
      newFrameId = clones.find((c) => c.type === 'frame')!.id;
      updateElements([...els, ...clones], false);
    } else {
      const el = baseElement('frame', pos[0], pos[1]);
      el.width = fb.w;
      el.height = fb.h;
      el.fillColor = frame.fillColor === 'transparent' ? '#ffffff' : frame.fillColor;
      el.strokeColor = frame.strokeColor;
      el.strokeWidth = frame.strokeWidth;
      el.strokeStyle = 'solid';
      el.label = nextName(frame.label || 'Frame', frameNames);
      newFrameId = el.id;
      updateElements([el, ...els], false);
    }
    endGesture();
    setSelection([newFrameId]);
    ensureVisible({ x: pos[0], y: pos[1], w: fb.w, h: fb.h });
  };

  /* ------------------------------ eraser logic ------------------------------ */

  const eraseAt = (x: number, y: number): boolean => {
    const els = getElements();
    const threshold = 6 / stateRef.current.view.zoom;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      // Frames are containers: the eraser removes their contents, never the
      // frame itself (delete a frame via selection or its context menu).
      if (el.type === 'frame') continue;
      if (el.locked || !hitTest(el, x, y, threshold)) continue;
      if (hiddenByClip(el, x, y, els)) continue;
      if (el.type === 'freedraw' && el.points && el.points.length > 2) {
        // Partial erase: drop points near the cursor, splitting the stroke.
        const radius = threshold + el.strokeWidth / 2 + 6;
        const runs: Point[][] = [];
        let run: Point[] = [];
        for (const [px, py] of el.points) {
          if (Math.hypot(el.x + px - x, el.y + py - y) > radius) {
            run.push([px, py]);
          } else if (run.length) {
            runs.push(run);
            run = [];
          }
        }
        if (run.length) runs.push(run);
        const pieces: SketchElement[] = runs
          .filter((r) => r.length >= 2)
          .map((r) => ({ ...el, id: uid(), seed: randomSeed(), points: r.map((p) => [...p] as Point) }));
        const next = [...els.slice(0, i), ...pieces, ...els.slice(i + 1)];
        updateElements(next, false);
      } else {
        updateElements(removeElements(els, new Set([el.id])), false);
      }
      return true;
    }
    return false;
  };

  /* ------------------------------ pointer events ---------------------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setCtxMenu(null);
    if (stateRef.current.editing) {
      commitEditing();
      return;
    }
    const canvas = canvasRef.current!;
    {
      // Clicks on the rulers are not canvas interactions.
      const rect = canvas.getBoundingClientRect();
      if (e.clientX - rect.left < RULER || e.clientY - rect.top < RULER) return;
    }
    if (e.button === 2) {
      // Right-click hold pans the canvas as a temporary hand tool (Fix 1.27);
      // releasing without dragging opens the context menu instead.
      canvas.setPointerCapture(e.pointerId);
      actionRef.current = {
        type: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origView: stateRef.current.view,
        rightBtn: true,
      };
      setCursor('grab');
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const [px, py] = toPage(e.clientX, e.clientY);
    const t = stateRef.current.tool;

    if (e.button === 1 || spaceDownRef.current) {
      actionRef.current = {
        type: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origView: stateRef.current.view,
      };
      setCursor('grabbing');
      return;
    }

    // Image crop mode (Fix 1.43): clicks manipulate the crop; a click
    // outside the image commits and exits.
    if (cropIdRef.current && t === 'select') {
      const el = getElements().find((x) => x.id === cropIdRef.current);
      if (!el || el.type !== 'image') {
        setCropId(null);
      } else {
        const [lx, ly] = toLocalPoint(el, px, py);
        const c = cropOf(el);
        const tolPx = 8 / stateRef.current.view.zoom;
        // Handle hit-testing uses the ROTATED corner positions; the scale
        // math uses the unrotated rect (pointer is unrotated during drag).
        const rawCorners: Point[] = [
          [el.x + c.x, el.y + c.y],
          [el.x + c.x + c.w, el.y + c.y],
          [el.x + c.x, el.y + c.y + c.h],
          [el.x + c.x + c.w, el.y + c.y + c.h],
        ];
        const rotCorners = cropContentCorners(el, c);
        const cornerIdx = rotCorners.findIndex(
          ([hx, hy]) => Math.hypot(lx - hx, ly - hy) <= tolPx
        );
        if (cornerIdx >= 0) {
          // Scale the image content, anchored at the opposite corner.
          const opposite = rawCorners[3 - cornerIdx];
          startGesture();
          actionRef.current = {
            type: 'crop-scale',
            id: el.id,
            orig: JSON.parse(JSON.stringify(el)),
            anchorX: opposite[0],
            anchorY: opposite[1],
            cornerX: rawCorners[cornerIdx][0],
            cornerY: rawCorners[cornerIdx][1],
          };
          return;
        }
        const eb = getBounds(el);
        const positions = handlePositions(eb);
        const frameHandle = HANDLES.find(
          (hk) => Math.hypot(lx - positions[hk][0], ly - positions[hk][1]) <= tolPx
        );
        if (frameHandle) {
          startGesture();
          actionRef.current = {
            type: 'crop-frame',
            id: el.id,
            orig: JSON.parse(JSON.stringify(el)),
            handle: frameHandle,
          };
          return;
        }
        const insideMask = pointInBounds(lx, ly, eb);
        const crad0 = cropRotRad(c);
        const cctr0: Point = [el.x + c.x + c.w / 2, el.y + c.y + c.h / 2];
        const [ulx, uly] = crad0 ? rotatePoint([lx, ly], cctr0, -crad0) : [lx, ly];
        const insideContent =
          ulx >= el.x + c.x && ulx <= el.x + c.x + c.w && uly >= el.y + c.y && uly <= el.y + c.y + c.h;
        if (insideMask || insideContent) {
          startGesture();
          actionRef.current = {
            type: 'crop-move',
            id: el.id,
            orig: JSON.parse(JSON.stringify(el)),
            startLX: lx,
            startLY: ly,
          };
          return;
        }
        // Just outside a corner: rotate the IMAGE CONTENT inside the fixed
        // mask (Fix 1.45.1) — the mask/element itself does not move.
        if (rotateZoneAt(e.clientX, e.clientY)) {
          const ccx = el.x + c.x + c.w / 2;
          const ccy = el.y + c.y + c.h / 2;
          startGesture();
          actionRef.current = {
            type: 'crop-rotate',
            id: el.id,
            orig: JSON.parse(JSON.stringify(el)),
            cx: ccx,
            cy: ccy,
            startAngle: Math.atan2(ly - ccy, lx - ccx),
          };
          return;
        }
        // Clicked outside: commit and leave crop mode; swallow the click.
        setCropId(null);
        return;
      }
    }

    if (t === 'select') {
      // A click on a link badge opens the URL instead of selecting.
      const linked = linkBadgeAt(px, py);
      if (linked?.link) {
        window.open(linked.link, '_blank', 'noopener');
        return;
      }
      if (rotateHandleAt(e.clientX, e.clientY) || rotateZoneAt(e.clientX, e.clientY)) {
        const frame = selectionFrame();
        const ids = new Set(stateRef.current.selection);
        const origEls = getElements().filter((el) => ids.has(el.id) && !el.locked);
        if (frame && origEls.length > 0) {
          const [fcx, fcy] = boundsCenter(frame.b);
          startGesture();
          actionRef.current = {
            type: 'rotate',
            cx: fcx,
            cy: fcy,
            startAngle: Math.atan2(py - fcy, px - fcx),
            origEls: JSON.parse(JSON.stringify(origEls)),
            ids: new Set(origEls.map((el) => el.id)),
            single: origEls.length === 1,
          };
          return;
        }
      }
      const endpointIndex = endpointAt(e.clientX, e.clientY);
      if (endpointIndex !== null) {
        startGesture();
        actionRef.current = { type: 'point-edit', id: stateRef.current.selection[0], index: endpointIndex };
        return;
      }
      // Corner-radius handle: drag to adjust shape rounding.
      const crEl = cornerRadiusHandleAt(e.clientX, e.clientY);
      if (crEl) {
        const b = getBounds(crEl);
        const spec = radiusShapeOf(crEl);
        const shapeKind = spec?.shape ?? crEl.type;
        startGesture();
        actionRef.current = {
          type: 'corner-radius',
          id: crEl.id,
          origEl: JSON.parse(JSON.stringify(crEl)),
          cornerX: shapeKind === 'rectangle' ? b.x + RECTANGLE_CR_INSET : b.x + b.w / 2,
          cornerY: shapeKind === 'rectangle' ? b.y + RECTANGLE_CR_INSET : b.y,
        };
        return;
      }
      // Bend-arrow handle: drag to curve an arrow/line.
      const bendEl = bendHandleAt(e.clientX, e.clientY);
      if (bendEl) {
        startGesture();
        actionRef.current = {
          type: 'bend-arrow',
          id: bendEl.id,
          origEl: JSON.parse(JSON.stringify(bendEl)),
        };
        return;
      }
      const handle = handleAt(e.clientX, e.clientY);
      if (handle && stateRef.current.selection.length > 0 && !singleLinearSelected()) {
        const ids = new Set(stateRef.current.selection);
        const origEls = getElements().filter((el) => ids.has(el.id) && !el.locked);
        if (origEls.length > 0) {
          const frame = selectionFrame()!;
          const [fcx, fcy] = boundsCenter(frame.b);
          startGesture();
          actionRef.current = {
            type: 'resize',
            handle,
            origBounds: frame.b,
            origEls: JSON.parse(JSON.stringify(origEls)),
            ids: new Set(origEls.map((el) => el.id)),
            frameRot: frame.rot,
            frameCx: fcx,
            frameCy: fcy,
          };
          return;
        }
      }
      const hit = selectableAt(px, py);
      if (hit) {
        let sel = stateRef.current.selection;
        const expanded = expandWithGroups(getElements(), [hit.id]);
        // Alt+Shift+drag must reach the duplicate branch below, so the
        // shift-toggles-selection shortcut only applies without Alt.
        if (e.shiftKey && !e.altKey) {
          sel = sel.includes(hit.id)
            ? sel.filter((id) => !expanded.includes(id))
            : [...new Set([...sel, ...expanded])];
          setSelection(sel);
          return;
        }
        if (!sel.includes(hit.id)) {
          sel = expanded;
          setSelection(sel);
        }
        // Alt+drag duplicates: clones move with the cursor, originals stay put.
        if (e.altKey) {
          const els0 = getElements();
          const idSet = withFrameContents(els0, sel);
          const source = els0.filter((el) => idSet.has(el.id) && !el.locked);
          if (source.length > 0) {
            startGesture();
            let clones = cloneElements(source, 0, 0);
            // Duplicated frames auto-increment their names (Fix 1.18 §6).
            const frameNames = els0.filter((x) => x.type === 'frame').map((x) => x.label ?? '');
            clones = clones.map((c) => {
              if (c.type !== 'frame') return c;
              const label = nextName(c.label || 'Frame', frameNames);
              frameNames.push(label);
              return { ...c, label };
            });
            updateElements([...els0, ...clones], false);
            const cloneIds = clones.map((c) => c.id);
            setSelection(cloneIds);
            actionRef.current = {
              type: 'move',
              startX: px,
              startY: py,
              origEls: JSON.parse(JSON.stringify(clones)),
              ids: new Set(cloneIds),
              moved: false,
              isDup: true,
              prevSelection: sel,
            };
            return;
          }
        }
        // Frames carry their contents when moved (Fix 1.17).
        const ids = withFrameContents(getElements(), sel);
        let els = getElements();
        // Dragging an arrow directly detaches endpoints bound to shapes
        // that are not moving along with it.
        const movingArrows = els.filter(
          (el) => ids.has(el.id) && el.type === 'arrow' && (el.startBinding || el.endBinding)
        );
        if (movingArrows.length > 0) {
          els = els.map((el) => {
            if (!ids.has(el.id) || el.type !== 'arrow') return el;
            const keepStart = el.startBinding && ids.has(el.startBinding);
            const keepEnd = el.endBinding && ids.has(el.endBinding);
            if (keepStart !== !!el.startBinding || keepEnd !== !!el.endBinding) {
              return {
                ...el,
                startBinding: keepStart ? el.startBinding : null,
                endBinding: keepEnd ? el.endBinding : null,
              };
            }
            return el;
          });
        }
        startGesture();
        if (els !== getElements()) updateElements(els, false);
        actionRef.current = {
          type: 'move',
          startX: px,
          startY: py,
          origEls: JSON.parse(JSON.stringify(els.filter((el) => ids.has(el.id)))),
          ids,
          moved: false,
        };
        return;
      }
      if (!e.shiftKey) setSelection([]);
      actionRef.current = { type: 'marquee', startX: px, startY: py };
      return;
    }

    if (t === 'rectangle' || t === 'ellipse' || t === 'diamond' || t === 'triangle') {
      startGesture();
      const el = baseElement(t, px, py);
      updateElements([...getElements(), el], false);
      actionRef.current = { type: 'draw', id: el.id, startX: px, startY: py, moved: false };
      return;
    }

    if (t === 'frame') {
      startGesture();
      const el = baseElement('frame', px, py);
      el.fillColor = '#ffffff';
      el.strokeColor = '#b9bcc7';
      el.strokeWidth = 1;
      el.strokeStyle = 'solid';
      // Frames sit at the back so their contents render on top.
      updateElements([el, ...getElements()], false);
      actionRef.current = { type: 'draw', id: el.id, startX: px, startY: py, moved: false };
      return;
    }

    if (t === 'line' || t === 'arrow') {
      startGesture();
      const el = baseElement(t, px, py);
      el.points = [
        [0, 0],
        [0, 0],
      ];
      updateElements([...getElements(), el], false);
      actionRef.current = { type: 'draw-linear', id: el.id, startX: px, startY: py, moved: false };
      return;
    }

    if (t === 'pencil') {
      startGesture();
      const el = baseElement('freedraw', px, py);
      el.points = [[0, 0]];
      updateElements([...getElements(), el], false);
      actionRef.current = { type: 'pencil', id: el.id };
      return;
    }

    if (t === 'eraser') {
      startGesture();
      const changed = eraseAt(px, py);
      actionRef.current = { type: 'erase', changed };
      return;
    }

    if (t === 'laser') {
      // Presentation pointer: temporary trail only, nothing is created.
      pushLaser(px, py);
      actionRef.current = { type: 'laser' };
      return;
    }

    if (t === 'lasso') {
      actionRef.current = { type: 'lasso', points: [[px, py]] };
      if (!e.shiftKey) setSelection([]);
      return;
    }

    if (t === 'embed') {
      // Clicking the canvas dismisses the link prompt.
      setTool('select');
      return;
    }

    if (t === 'text') {
      // Click places point text; click-drag creates a fixed-width text box.
      startGesture();
      const el = baseElement('text', px, py);
      el.text = '';
      el.fontSize = stateRef.current.defaults.fontSize;
      el.textAlign = stateRef.current.defaults.textAlign;
      el.textColor = stateRef.current.defaults.textColor;
      el.boxed = true;
      updateElements([...getElements(), el], false);
      actionRef.current = { type: 'draw-text', id: el.id, startX: px, startY: py, moved: false };
      return;
    }

    if (t === 'sticky') {
      startGesture();
      const size = 170;
      const el = baseElement('sticky', px - size / 2, py - size / 4);
      el.width = size;
      el.height = size;
      el.text = '';
      el.fontSize = stateRef.current.defaults.fontSize;
      el.textAlign = stateRef.current.defaults.textAlign;
      el.textColor = contrastTextColor(el.fillColor);
      updateElements([...getElements(), el], false);
      setTool('select');
      beginTextEdit(el.id, true);
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const action = actionRef.current;
    let [px, py] = toPage(e.clientX, e.clientY);
    pointerPageRef.current = [px, py];

    if (!action) {
      updateHoverCursor(e.clientX, e.clientY, px, py);
      // Alt inspection mode re-measures against whatever the cursor hovers.
      if (altHeldRef.current) setRedrawTick((t) => t + 1);
      return;
    }

    switch (action.type) {
      case 'pan': {
        const dx = e.clientX - action.startX;
        const dy = e.clientY - action.startY;
        if (action.rightBtn && !action.moved) {
          if (Math.hypot(dx, dy) < 4) return;
          action.moved = true;
          setCursor('grabbing');
        }
        setView({
          ...action.origView,
          offsetX: action.origView.offsetX + dx,
          offsetY: action.origView.offsetY + dy,
        });
        return;
      }
      case 'draw':
      case 'draw-text': {
        action.moved = true;
        const els = getElements().map((el) => {
          if (el.id !== action.id) return el;
          const r = action.type === 'draw'
            ? drawBounds(action.startX, action.startY, px, py, e.shiftKey)
            : normalizeRect(action.startX, action.startY, px, py);
          return { ...el, x: r.x, y: r.y, width: r.w, height: r.h };
        });
        updateElements(els, false);
        return;
      }
      case 'draw-linear': {
        action.moved = true;
        const els = getElements().map((el) =>
          el.id === action.id
            ? { ...el, points: [[0, 0], [px - action.startX, py - action.startY]] as Point[] }
            : el
        );
        updateElements(els, false);
        const target = findBindTarget(getElements(), px, py, 8, action.id);
        setBindHighlight(target ? target.id : null);
        return;
      }
      case 'pencil': {
        const els = getElements().map((el) =>
          el.id === action.id && el.points
            ? { ...el, points: [...el.points, [px - el.x, py - el.y]] as Point[] }
            : el
        );
        updateElements(els, false);
        return;
      }
      case 'move': {
        let dx = px - action.startX;
        let dy = py - action.startY;
        if (!action.moved && Math.hypot(dx, dy) < 1) return;
        action.moved = true;
        if (e.shiftKey) {
          // Shift constrains movement (plain move or Alt-duplicate) to the
          // nearest of 8 directions: horizontal, vertical, 45° diagonals.
          const dist = Math.hypot(dx, dy);
          const snapAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          dx = Math.cos(snapAngle) * dist;
          dy = Math.sin(snapAngle) * dist;
        }
        // The pointer decides frame membership while dragging (Fix 1.39):
        // moved elements join the frame under the cursor — regardless of how
        // much of the element overlaps it — and leave when the cursor leaves.
        // Children of a frame that is itself being moved stay with their frame.
        const all = getElements();
        const movedIds = new Set(action.origEls.map((o) => o.id));
        const hasLooseMoved = action.origEls.some(
          (o) => o.type !== 'frame' && !(o.frameId && movedIds.has(o.frameId))
        );
        const target = hasLooseMoved
          ? (() => {
              const f = frameAtPoint(all.filter((el) => !movedIds.has(el.id)), px, py);
              return f && !f.locked ? f : null;
            })()
          : null;

        // Smart alignment guides + soft snapping (Fix 1.41): the dragged
        // selection's visual box aligns to the parent frame's edges/centers
        // and to sibling objects in that frame (5px screen threshold).
        guidesRef.current = null;
        {
          const ob = boundsUnion(action.origEls.map(getAABB));
          const candBoxes: Bounds[] = [];
          if (target) {
            candBoxes.push(getBounds(target));
            for (const el of all) {
              if (!movedIds.has(el.id) && el.type !== 'frame' && el.frameId === target.id) {
                candBoxes.push(getAABB(el));
              }
            }
          } else {
            for (const el of all) {
              if (movedIds.has(el.id)) continue;
              candBoxes.push(el.type === 'frame' ? getBounds(el) : getAABB(el));
            }
          }
          const tol = 5 / stateRef.current.view.zoom;
          const stops = (o: number, len: number) => [o, o + len / 2, o + len];
          let adjX: number | null = null;
          let adjY: number | null = null;
          for (const c of candBoxes) {
            for (const cv of stops(c.x, c.w)) {
              for (const m of stops(ob.x + dx, ob.w)) {
                const d = cv - m;
                if (Math.abs(d) <= tol && (adjX === null || Math.abs(d) < Math.abs(adjX))) adjX = d;
              }
            }
            for (const cv of stops(c.y, c.h)) {
              for (const m of stops(ob.y + dy, ob.h)) {
                const d = cv - m;
                if (Math.abs(d) <= tol && (adjY === null || Math.abs(d) < Math.abs(adjY))) adjY = d;
              }
            }
          }
          // Soft snap (skipped under Shift so the 8-direction constraint wins).
          if (!e.shiftKey) {
            if (adjX !== null) dx += adjX;
            if (adjY !== null) dy += adjY;
          }
          const fbx = { x: ob.x + dx, y: ob.y + dy, w: ob.w, h: ob.h };
          const v: { pos: number; a: number; b: number }[] = [];
          const h: { pos: number; a: number; b: number }[] = [];
          const seenV = new Set<number>();
          const seenH = new Set<number>();
          for (const c of candBoxes) {
            for (const cv of stops(c.x, c.w)) {
              if (stops(fbx.x, fbx.w).some((m) => Math.abs(cv - m) < 0.5)) {
                const key = Math.round(cv * 10);
                if (!seenV.has(key)) {
                  seenV.add(key);
                  v.push({ pos: cv, a: Math.min(fbx.y, c.y), b: Math.max(fbx.y + fbx.h, c.y + c.h) });
                }
              }
            }
            for (const cv of stops(c.y, c.h)) {
              if (stops(fbx.y, fbx.h).some((m) => Math.abs(cv - m) < 0.5)) {
                const key = Math.round(cv * 10);
                if (!seenH.has(key)) {
                  seenH.add(key);
                  h.push({ pos: cv, a: Math.min(fbx.x, c.x), b: Math.max(fbx.x + fbx.w, c.x + c.w) });
                }
              }
            }
          }
          if (v.length || h.length) guidesRef.current = { v, h };
        }

        const orig = new Map(action.origEls.map((el) => [el.id, el]));
        let els = all.map((el) => {
          const o = orig.get(el.id);
          if (!o || el.locked) return el;
          return { ...el, x: o.x + dx, y: o.y + dy };
        });
        els = els.map((el) => {
          if (!movedIds.has(el.id) || el.type === 'frame') return el;
          if (el.frameId && movedIds.has(el.frameId)) return el;
          const next = target?.id ?? null;
          return (el.frameId ?? null) === next ? el : { ...el, frameId: next };
        });
        els = updateBoundArrows(els);
        updateElements(els, false);
        setDropFrame(target ? target.id : null);
        return;
      }
      case 'rotate': {
        const pointerAngle = Math.atan2(py - action.cy, px - action.cx);
        let delta = pointerAngle - action.startAngle;
        if (e.shiftKey) {
          const snap = Math.PI / 12; // 15°
          delta = Math.round(delta / snap) * snap;
        }
        const deg = (delta * 180) / Math.PI;
        const orig = new Map(action.origEls.map((o) => [o.id, o]));
        let els = getElements().map((el) => {
          const o = orig.get(el.id);
          if (!o) return el;
          if (o.points && o.points.length > 0) {
            // Linear elements bake rotation into their points; connectors detach.
            const pts = (o.points as Point[]).map(([qx, qy]) =>
              rotatePoint([o.x + qx, o.y + qy], [action.cx, action.cy], delta)
            );
            const [ax, ay] = pts[0];
            return {
              ...el,
              x: ax,
              y: ay,
              points: pts.map(([qx, qy]) => [qx - ax, qy - ay] as Point),
              startBinding: null,
              endBinding: null,
            };
          }
          const ob = getBounds(o);
          const oc = boundsCenter(ob);
          const nc = rotatePoint(oc, [action.cx, action.cy], delta);
          let rot = (o.rotation ?? 0) + deg;
          if (e.shiftKey && action.single) rot = Math.round(rot / 15) * 15;
          rot = ((rot % 360) + 360) % 360;
          return { ...el, x: o.x + (nc[0] - oc[0]), y: o.y + (nc[1] - oc[1]), rotation: rot };
        });
        els = updateBoundArrows(els);
        updateElements(els, false);
        // Angle readout near the cursor.
        const shown = action.single
          ? (els.find((el) => action.ids.has(el.id))?.rotation ?? 0)
          : ((Math.round(deg) % 360) + 360) % 360;
        const v = stateRef.current.view;
        setRotationDisplay({
          deg: Math.round(shown),
          x: px * v.zoom + v.offsetX + 14,
          y: py * v.zoom + v.offsetY - 24,
        });
        return;
      }
      case 'resize': {
        if (action.frameRot) {
          [px, py] = rotatePoint([px, py], [action.frameCx, action.frameCy], -action.frameRot);
        }
        // Shift + corner drag keeps aspect ratio from the opposite corner.
        // Alt/Option keeps the existing center-based proportional behavior.
        // The Dimensions-panel lock (Fix 1.34.1) forces every handle —
        // corners and sides — to resize proportionally.
        const lockOn = stateRef.current.ratioLocked;
        const proportional =
          (action.handle.length === 2 && (e.shiftKey || e.altKey || lockOn)) ||
          (action.handle.length === 1 && lockOn);
        const nb = resizeBounds(action.origBounds, action.handle, px, py, e.shiftKey, e.altKey, lockOn);
        const ob = action.origBounds;
        const sx = nb.w / Math.max(ob.w, 0.001);
        const sy = nb.h / Math.max(ob.h, 0.001);
        const orig = new Map(action.origEls.map((el) => [el.id, el]));
        let els = getElements().map((el) => {
          const o = orig.get(el.id);
          if (!o) return el;
          const scaled: SketchElement = {
            ...el,
            x: nb.x + (o.x - ob.x) * sx,
            y: nb.y + (o.y - ob.y) * sy,
            width: o.width * sx,
            height: o.height * sy,
          };
          if (o.crop) {
            scaled.crop = { ...o.crop, x: o.crop.x * sx, y: o.crop.y * sy, w: o.crop.w * sx, h: o.crop.h * sy };
          }
          if (o.points) {
            scaled.points = o.points.map(([qx, qy]) => [qx * sx, qy * sy] as Point);
          }
          if (o.controlPoint) {
            scaled.controlPoint = [o.controlPoint[0] * sx, o.controlPoint[1] * sy];
          }
          if (proportional && o.cornerRadius) {
            const b = getBounds(scaled);
            scaled.cornerRadius = clampCornerRadius(o.cornerRadius * sx, b.w, b.h);
          }
          if (o.type === 'text') {
            // Resizing any standalone text fixes its width; height always
            // hugs the wrapped content — growing AND shrinking (Fix 1.8).
            scaled.boxed = true;
            if (proportional && o.fontSize) scaled.fontSize = Math.max(6, o.fontSize * sy);
            scaled.height = hugBoxedTextHeight(scaled);
            return scaled;
          }
          if (o.type === 'sticky' && o.fontSize) {
            scaled.fontSize = Math.max(6, o.fontSize * sy);
          }
          return scaled;
        });
        els = updateBoundArrows(els);
        updateElements(els, false);
        return;
      }
      case 'point-edit': {
        let els = getElements().map((el) => {
          if (el.id !== action.id || !el.points) return el;
          const pts = absPoints(el);
          pts[action.index] = [px, py];
          const [ax, ay] = pts[0];
          return {
            ...el,
            x: ax,
            y: ay,
            points: pts.map(([qx, qy]) => [qx - ax, qy - ay] as Point),
            ...(action.index === 0 ? { startBinding: null } : { endBinding: null }),
          };
        });
        updateElements(els, false);
        const target = findBindTarget(getElements(), px, py, 8, action.id);
        setBindHighlight(target ? target.id : null);
        return;
      }
      case 'marquee': {
        const r = normalizeRect(action.startX, action.startY, px, py);
        setMarquee(r);
        const els = getElements();
        const hitIds = els
          .filter((el) => el.type !== 'frame' && !el.locked && !isInsideLockedFrame(el, els) && boundsIntersect(r, getAABB(el)))
          .map((el) => el.id);
        setSelection(expandWithGroups(els, hitIds));
        return;
      }
      case 'erase': {
        if (eraseAt(px, py)) action.changed = true;
        return;
      }
      case 'laser': {
        pushLaser(px, py);
        return;
      }
      case 'lasso': {
        action.points.push([px, py]);
        setRedrawTick((t) => t + 1);
        return;
      }
      case 'crop-move': {
        const el = getElements().find((x) => x.id === action.id);
        if (!el) return;
        const [lx, ly] = toLocalPoint(action.orig, px, py);
        const oc = action.orig.crop ?? { x: 0, y: 0, w: action.orig.width, h: action.orig.height };
        const next = { ...el, crop: { ...oc, x: oc.x + (lx - action.startLX), y: oc.y + (ly - action.startLY) } };
        updateElements(getElements().map((x) => (x.id === el.id ? next : x)), false);
        return;
      }
      case 'crop-scale': {
        const el = getElements().find((x) => x.id === action.id);
        if (!el) return;
        let [lx, ly] = toLocalPoint(action.orig, px, py);
        {
          // Content rotation (Fix 1.45.1): scale math runs in the content's
          // unrotated space.
          const oc0 = action.orig.crop ?? { x: 0, y: 0, w: action.orig.width, h: action.orig.height };
          const crad = cropRotRad(oc0);
          if (crad) {
            const ctr: Point = [
              action.orig.x + oc0.x + oc0.w / 2,
              action.orig.y + oc0.y + oc0.h / 2,
            ];
            [lx, ly] = rotatePoint([lx, ly], ctr, -crad);
          }
        }
        const oc = action.orig.crop ?? { x: 0, y: 0, w: action.orig.width, h: action.orig.height };
        // Alt/Option resizes from the content CENTER (Fix 1.45.3); otherwise
        // the opposite corner stays anchored. Checked live so the modifier
        // can be pressed or released mid-drag.
        const fromCenter = e.altKey;
        const ax = fromCenter ? action.orig.x + oc.x + oc.w / 2 : action.anchorX;
        const ay = fromCenter ? action.orig.y + oc.y + oc.h / 2 : action.anchorY;
        const denomX = action.cornerX - ax;
        const denomY = action.cornerY - ay;
        const sx = denomX !== 0 ? (lx - ax) / denomX : 0;
        const sy = denomY !== 0 ? (ly - ay) / denomY : 0;
        // The Dimensions lock governs the content transform (Fix 1.44.3):
        // locked (or Shift) scales proportionally, unlocked is free-form.
        const proportional = stateRef.current.ratioLocked || e.shiftKey;
        let scX = Math.max(0.05, sx);
        let scY = Math.max(0.05, sy);
        if (proportional) {
          const sc = Math.max(0.05, Math.max(sx, sy));
          scX = sc;
          scY = sc;
        }
        const newW = oc.w * scX;
        const newH = oc.h * scY;
        // Keep the anchor (corner or center) fixed in element-local space.
        const anchorLX = ax - action.orig.x;
        const anchorLY = ay - action.orig.y;
        const newX = anchorLX - (anchorLX - oc.x) * scX;
        const newY = anchorLY - (anchorLY - oc.y) * scY;
        const next = { ...el, crop: { x: newX, y: newY, w: newW, h: newH, rotation: oc.rotation } };
        updateElements(getElements().map((x) => (x.id === el.id ? next : x)), false);
        setRotationDisplay(null);
        return;
      }
      case 'crop-rotate': {
        const el = getElements().find((x) => x.id === action.id);
        if (!el) return;
        const [lx, ly] = toLocalPoint(action.orig, px, py);
        const delta = Math.atan2(ly - action.cy, lx - action.cx) - action.startAngle;
        const oc = action.orig.crop ?? { x: 0, y: 0, w: action.orig.width, h: action.orig.height };
        let deg = (oc.rotation ?? 0) + (delta * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg % 360) + 360) % 360;
        updateElements(
          getElements().map((x) => (x.id === el.id ? { ...el, crop: { ...oc, rotation: deg } } : x)),
          false
        );
        const v = stateRef.current.view;
        setRotationDisplay({
          deg: Math.round(deg),
          x: px * v.zoom + v.offsetX + 18,
          y: py * v.zoom + v.offsetY - 26,
        });
        return;
      }
      case 'crop-frame': {
        const el = getElements().find((x) => x.id === action.id);
        if (!el) return;
        const [lx, ly] = toLocalPoint(action.orig, px, py);
        const ob = getBounds(action.orig);
        const nb = resizeBounds(ob, action.handle, lx, ly, e.shiftKey, false, stateRef.current.ratioLocked);
        const oc = action.orig.crop ?? { x: 0, y: 0, w: action.orig.width, h: action.orig.height };
        // The mask moves; the image content stays put in absolute space.
        const next = {
          ...el,
          x: nb.x,
          y: nb.y,
          width: nb.w,
          height: nb.h,
          crop: { ...oc, x: action.orig.x + oc.x - nb.x, y: action.orig.y + oc.y - nb.y },
        };
        updateElements(updateBoundArrows(getElements().map((x) => (x.id === el.id ? next : x))), false);
        return;
      }
      case 'corner-radius': {
        // Compute radius from distance of pointer to the corner origin.
        const [lx, ly] = action.origEl.rotation
          ? rotatePoint([px, py], boundsCenter(getBounds(action.origEl)), -rotationRad(action.origEl))
          : [px, py];
        const spec = radiusShapeOf(action.origEl);
        const shapeKind = spec?.shape ?? action.origEl.type;
        let dist = Math.hypot(lx - action.cornerX, ly - action.cornerY);
        if (shapeKind === 'triangle') dist = Math.max(0, dist - TRIANGLE_CR_INSET);
        if (shapeKind === 'rectangle') dist = dist / Math.SQRT2;
        const b = getBounds(action.origEl);
        let clamped = clampCornerRadius(dist, b.w, b.h);
        // Triangles round more conservatively so corners never overlap.
        if (shapeKind === 'triangle') clamped = Math.min(clamped, Math.min(b.w, b.h) * 0.25);
        const els = getElements().map((el) =>
          el.id === action.id
            ? el.type === 'image' && el.mask
              ? { ...el, mask: { ...el.mask, cornerRadius: clamped } }
              : { ...el, cornerRadius: clamped }
            : el
        );
        updateElements(els, false);
        // Show radius label near cursor.
        const v = stateRef.current.view;
        setRotationDisplay({
          deg: Math.round(clamped), // reuse rotation display for the label
          x: px * v.zoom + v.offsetX + 14,
          y: py * v.zoom + v.offsetY - 24,
        });
        return;
      }
      case 'bend-arrow': {
        // The visible handle sits on the curve at t=0.5; solve for the internal
        // Bézier control point so the curve midpoint tracks the cursor:
        // B(0.5) = 0.25·P0 + 0.5·P1 + 0.25·P2  ⇒  P1 = 2·B − (P0 + P2)/2
        const pts = absPoints(action.origEl);
        const cp: Point = [
          2 * px - (pts[0][0] + pts[1][0]) / 2 - action.origEl.x,
          2 * py - (pts[0][1] + pts[1][1]) / 2 - action.origEl.y,
        ];
        const els = getElements().map((el) =>
          el.id === action.id ? { ...el, controlPoint: cp, arrowType: 'curved' as const } : el
        );
        updateElements(els, false);
        return;
      }
    }
  };

  /** Context-aware right-click menu (Right Click fix): items depend on what
   * was clicked — empty canvas, frame, shape, text, image, mask, line/arrow,
   * group, multi-selection, locked object, or crop-edit mode. */
  const buildContextMenu = (hit: SketchElement | null): CtxItem[] => {
    const els = getElements();
    const a = (action: string, label: string, extra?: Partial<Exclude<CtxItem, 'div'>>) =>
      ({ label, run: () => onMenuAction(action), ...extra }) as Exclude<CtxItem, 'div'>;

    // Crop / mask edit mode has its own compact menu.
    if (cropIdRef.current) {
      const cel = els.find((x) => x.id === cropIdRef.current);
      const isMask = cel?.type === 'image' && !!cel.mask;
      return [
        { label: isMask ? 'Exit mask edit' : 'Exit crop mode', run: () => setCropId(null) },
        'div',
        a('fit', 'Fit'),
        a('fill', 'Fill'),
        a('reset-crop', isMask ? 'Reset image position' : 'Reset crop'),
      ];
    }

    // Empty canvas.
    if (!hit) {
      return [
        a('paste', 'Paste', { hint: '⌘V' }),
        a('select-all', 'Select all', { hint: '⌘A' }),
        'div',
        a('add-frame', 'Add frame', { hint: 'F' }),
        a('add-text', 'Add text', { hint: 'T' }),
        a('add-image', 'Add image', { hint: 'I' }),
        'div',
        a('zoom-fit', 'Zoom to fit', { hint: '⌘0' }),
        a('reset-zoom', 'Reset zoom'),
      ];
    }

    const selIds = stateRef.current.selection;
    const selected = els.filter((x) => selIds.includes(x.id));

    // Locked object(s): only safe actions.
    if (selected.length > 0 && selected.every((x) => x.locked)) {
      return [
        a('lock', 'Unlock', { hint: '⇧⌘L' }),
        a('copy', 'Copy', { hint: '⌘C' }),
      ];
    }

    // Frame menu.
    if (hit.type === 'frame') {
      return [
        { label: 'Rename frame', run: () => beginTextEdit(hit.id, false, 'label') },
        { label: 'Duplicate frame', run: () => onFrameMenuAction('duplicate'), hint: '⌘D' },
        { label: 'Export frame (PNG)', run: () => onFrameMenuAction('export-png') },
        { label: 'Export frame (PDF)', run: () => onFrameMenuAction('export-pdf') },
        'div',
        { label: 'Add frame above', run: () => addFrameDirectional(hit, 'top', false) },
        { label: 'Add frame below', run: () => addFrameDirectional(hit, 'bottom', false) },
        { label: 'Add frame left', run: () => addFrameDirectional(hit, 'left', false) },
        { label: 'Add frame right', run: () => addFrameDirectional(hit, 'right', false) },
        'div',
        { label: hit.locked ? 'Unlock frame' : 'Lock frame', run: () => onFrameMenuAction('lock') },
        'div',
        { label: 'Bring forward', run: () => onFrameMenuAction('forward'), hint: '⌘]' },
        { label: 'Send backward', run: () => onFrameMenuAction('backward'), hint: '⌘[' },
        'div',
        { label: 'Delete frame', run: () => onFrameMenuAction('delete'), danger: true },
      ];
    }

    const CLOSED = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);
    // Mirror makeClippingMask's rule: exactly one image plus one closed
    // shape that sits ABOVE it.
    const maskImgs = selected.filter((x) => x.type === 'image' && !x.mask && !x.locked);
    const maskShps = selected.filter((x) => CLOSED.has(x.type) && !x.locked);
    const canMakeMask =
      maskImgs.length === 1 &&
      maskShps.length === 1 &&
      els.findIndex((x) => x.id === maskShps[0].id) > els.findIndex((x) => x.id === maskImgs[0].id);

    const commonEdit: CtxItem[] = [
      a('copy', 'Copy', { hint: '⌘C' }),
      a('cut', 'Cut', { hint: '⌘X' }),
      a('duplicate', 'Duplicate', { hint: '⌘D' }),
    ];
    const layerTail: CtxItem[] = [
      'div',
      a('front', 'Bring to front', { hint: ']' }),
      a('forward', 'Bring forward', { hint: '⌘]' }),
      a('backward', 'Send backward', { hint: '⌘[' }),
      a('back', 'Send to back', { hint: '[' }),
      'div',
      a('lock', selected.some((x) => x.locked) ? 'Unlock' : 'Lock', { hint: '⇧⌘L' }),
      'div',
      a('delete', 'Delete', { danger: true, hint: '⌫' }),
    ];
    const linkItem = a('add-link', selected.some((x) => x.link) ? 'Edit link…' : 'Add link…');

    // Multi-selection.
    if (selected.length > 1) {
      const allGrouped =
        selected.every((x) => x.groupId) && new Set(selected.map((x) => x.groupId)).size === 1;
      const items: CtxItem[] = [];
      items.push(allGrouped ? a('ungroup', 'Ungroup', { hint: '⇧⌘G' }) : a('group', 'Group', { hint: '⌘G' }));
      if (canMakeMask) items.push({ label: 'Make clipping mask', run: onMakeMask, hint: '⌘7' });
      items.push('div', ...commonEdit, 'div');
      items.push(
        a('align-left', 'Align left'),
        a('align-centerX', 'Align horizontal center'),
        a('align-right', 'Align right'),
        a('align-top', 'Align top'),
        a('align-centerY', 'Align vertical middle'),
        a('align-bottom', 'Align bottom'),
        'div',
        a('distribute-h', 'Distribute horizontally', { disabled: selected.length < 3 }),
        a('distribute-v', 'Distribute vertically', { disabled: selected.length < 3 }),
      );
      items.push(...layerTail);
      return items;
    }

    // Single element by type.
    const items: CtxItem[] = [];
    if (hit.type === 'image') {
      if (hit.mask) {
        items.push(
          { label: 'Edit clipping mask', run: () => { setSelection([hit.id]); setCropId(hit.id); } },
          { label: 'Release clipping mask', run: onReleaseMask, hint: '⌥⌘7' },
          'div',
          a('fit', 'Fit image'),
          a('fill', 'Fill mask'),
          a('reset-crop', 'Reset image position'),
        );
      } else {
        items.push(
          { label: hit.crop ? 'Edit crop' : 'Crop image', run: () => { setSelection([hit.id]); setCropId(hit.id); } },
        );
        if (hit.crop) items.push(a('reset-crop', 'Reset crop'));
        items.push(a('fit', 'Fit'), a('fill', 'Fill'));
      }
      items.push('div', ...commonEdit, 'div', linkItem, ...layerTail);
      return items;
    }
    if (hit.type === 'text' || (hit.text != null && hit.text !== '')) {
      items.push(
        { label: 'Edit text', run: () => beginTextEdit(hit.id, false) },
        'div',
        ...commonEdit,
        'div',
        a('font-inc', 'Increase font size', { hint: '⇧⌘>' }),
        a('font-dec', 'Decrease font size', { hint: '⇧⌘<' }),
        'div',
        linkItem,
        ...layerTail
      );
      return items;
    }
    if (hit.type === 'line' || hit.type === 'arrow' || hit.type === 'freedraw') {
      items.push(...commonEdit);
      if (hit.type === 'line' || hit.type === 'arrow') {
        const mode = hit.arrowHead ?? (hit.type === 'arrow' ? 'end' : 'none');
        items.push(
          'div',
          ...(
            [
              ['none', 'Arrowheads: none'],
              ['start', 'Arrowhead at start'],
              ['end', 'Arrowhead at end'],
              ['both', 'Arrowheads: both'],
            ] as const
          ).map(([m, label]) => ({
            label: mode === m ? `✓ ${label}` : label,
            run: () => onMenuAction(`arrowhead-${m}`),
          })),
          'div',
          {
            label: 'Reverse direction',
            run: () => {
              updateElements(
                getElements().map((x) => {
                  if (x.id !== hit.id || !x.points || x.points.length < 2) return x;
                  const pts = absPoints(x);
                  const rev = [...pts].reverse();
                  const [ax, ay] = rev[0];
                  return {
                    ...x,
                    x: ax,
                    y: ay,
                    points: rev.map(([qx, qy]) => [qx - ax, qy - ay] as Point),
                    controlPoint: x.controlPoint
                      ? ([x.x + x.controlPoint[0] - ax, x.y + x.controlPoint[1] - ay] as Point)
                      : x.controlPoint,
                    startBinding: x.endBinding ?? null,
                    endBinding: x.startBinding ?? null,
                  };
                }),
                true
              );
            },
          }
        );
      }
      if (hit.controlPoint) {
        items.push({
          label: 'Straighten arrow',
          run: () => {
            updateElements(
              getElements().map((x) =>
                x.id === hit.id ? { ...x, controlPoint: null, arrowType: 'straight' as const } : x
              ),
              true
            );
          },
        });
      }
      items.push('div', linkItem, ...layerTail);
      return items;
    }
    // Shapes, stickies, embeds.
    items.push(...commonEdit);
    if (canMakeMask) items.push('div', { label: 'Make clipping mask', run: onMakeMask, hint: '⌘7' });
    items.push('div', linkItem, ...layerTail);
    return items;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const action = actionRef.current;
    actionRef.current = null;
    setMarquee(null);
    setBindHighlight(null);
    setDropFrame(null);
    guidesRef.current = null;
    if (!action) return;
    const [px, py] = toPage(e.clientX, e.clientY);

    switch (action.type) {
      case 'pan': {
        if (action.rightBtn && !action.moved && stateRef.current.tool === 'select') {
          // Plain right-click (no drag): context-aware menu (Right Click fix).
          let hit = cropIdRef.current ? null : selectableAt(px, py);
          if (!hit && !cropIdRef.current) {
            // Locked elements are skipped by normal picking but must stay
            // recoverable through right-click: pick the topmost locked one.
            const els2 = getElements();
            const threshold2 = 6 / stateRef.current.view.zoom;
            for (let i = els2.length - 1; i >= 0; i--) {
              const el2 = els2[i];
              if (!el2.locked) continue;
              if (hiddenByClip(el2, px, py, els2)) continue;
              if (hitTest(el2, px, py, threshold2)) {
                hit = el2;
                break;
              }
            }
          }
          if (!cropIdRef.current) {
            if (hit && !stateRef.current.selection.includes(hit.id)) {
              setSelection(expandWithGroups(getElements(), [hit.id]));
            } else if (!hit) {
              setSelection([]);
            }
          }
          // Build against the just-updated selection. Raw viewport coords —
          // the placement effect measures the real menu and clamps/centers.
          const rawX = e.clientX;
          const rawY = e.clientY;
          setTimeout(() => {
            const items = buildContextMenu(hit);
            if (items.length === 0) return;
            setCtxMenu({ x: rawX, y: rawY, items });
          }, 0);
        }
        if (spaceDownRef.current) setCursor('grab');
        else updateHoverCursor(e.clientX, e.clientY, px, py);
        return;
      }
      case 'draw': {
        let els = getElements();
        const el = els.find((x) => x.id === action.id);
        if (!el || !action.moved || (el.width < 3 && el.height < 3)) {
          updateElements(els.filter((x) => x.id !== action.id), false);
        } else {
          if (el.type === 'frame' && !el.label) {
            const names = els.filter((x) => x.type === 'frame').map((x) => x.label ?? '');
            els = els.map((x) => (x.id === el.id ? { ...x, label: nextName('Frame', names) } : x));
            updateElements(els, false);
          }
          setSelection([action.id]);
          setTool('select');
        }
        endGesture();
        return;
      }
      case 'draw-text': {
        const els = getElements();
        const el = els.find((x) => x.id === action.id);
        if (!el) {
          endGesture();
          return;
        }
        const fontSize = el.fontSize ?? stateRef.current.defaults.fontSize;
        const lineH = fontSize * LINE_HEIGHT;
        let next: SketchElement;
        if (!action.moved || (el.width < 16 && el.height < 16)) {
          // Simple click: auto-width point text at the click position.
          const m = measureText('', fontSize);
          next = {
            ...el,
            boxed: false,
            x: action.startX,
            y: action.startY - fontSize * 0.65,
            width: m.w,
            height: m.h,
          };
        } else {
          // Dragged: a fixed-width text box; height hugs content from the start.
          next = { ...el, width: Math.max(el.width, 40) };
          next.height = hugBoxedTextHeight(next);
        }
        updateElements(els.map((x) => (x.id === el.id ? next : x)), false);
        setTool('select');
        beginTextEdit(el.id, true);
        return;
      }
      case 'draw-linear': {
        let els = getElements();
        const el = els.find((x) => x.id === action.id);
        const length = el?.points ? Math.hypot(el.points[1][0], el.points[1][1]) : 0;
        if (!el || !action.moved || length < 4) {
          updateElements(els.filter((x) => x.id !== action.id), false);
          endGesture();
          return;
        }
        if (el.type === 'arrow') {
          const startTarget = findBindTarget(els, action.startX, action.startY, 8, el.id);
          const endTarget = findBindTarget(els, px, py, 8, el.id);
          // Binding both ends to the same element would collapse the arrow.
          if ((startTarget || endTarget) && startTarget?.id !== endTarget?.id) {
            els = els.map((x) =>
              x.id === el.id
                ? {
                    ...x,
                    startBinding: startTarget ? startTarget.id : null,
                    endBinding: endTarget ? endTarget.id : null,
                  }
                : x
            );
            els = updateBoundArrows(els);
            updateElements(els, false);
          }
        }
        setSelection([action.id]);
        setTool('select');
        endGesture();
        return;
      }
      case 'pencil': {
        endGesture();
        return;
      }
      case 'move': {
        if (!action.moved) {
          if (action.isDup) {
            // Alt+click without dragging: discard the clones we staged.
            updateElements(getElements().filter((el) => !action.ids.has(el.id)), false);
            setSelection(action.prevSelection ?? []);
          } else if (!e.shiftKey) {
            // Plain click on an already-selected element: reduce selection to it.
            const hit = selectableAt(px, py);
            if (hit) setSelection(expandWithGroups(getElements(), [hit.id]));
          }
        }
        endGesture();
        return;
      }
      case 'rotate': {
        setRotationDisplay(null);
        endGesture();
        return;
      }
      case 'resize': {
        // Shapes with contained text auto-grow if their text no longer fits.
        let els = getElements();
        const grown = els.map((el) => (action.ids.has(el.id) ? ensureTextFits(el) : el));
        if (grown.some((el, i) => el !== els[i])) {
          updateElements(updateBoundArrows(grown), false);
        }
        endGesture();
        return;
      }
      case 'point-edit': {
        let els = getElements();
        const el = els.find((x) => x.id === action.id);
        if (el?.type === 'arrow') {
          const target = findBindTarget(els, px, py, 8, el.id);
          const otherBinding = action.index === 0 ? el.endBinding : el.startBinding;
          if (target && target.id !== otherBinding) {
            els = els.map((x) =>
              x.id === el.id
                ? action.index === 0
                  ? { ...x, startBinding: target.id }
                  : { ...x, endBinding: target.id }
                : x
            );
            els = updateBoundArrows(els);
            updateElements(els, false);
          }
        }
        endGesture();
        return;
      }
      case 'marquee':
        return;
      case 'erase': {
        endGesture();
        return;
      }
      case 'laser':
        return; // trail fades on its own
      case 'lasso': {
        if (action.points.length >= 3) {
          const els = getElements();
          const hitIds = els
            .filter((el) => el.type !== 'frame' && !el.locked && !isInsideLockedFrame(el, els) && lassoCaptures(action.points, getAABB(el)))
            .map((el) => el.id);
          if (hitIds.length > 0 || !e.shiftKey) {
            setSelection(expandWithGroups(els, hitIds));
          }
          if (hitIds.length > 0) setTool('select');
        }
        setRedrawTick((t) => t + 1);
        return;
      }
      case 'corner-radius': {
        setRotationDisplay(null);
        endGesture();
        return;
      }
      case 'crop-move':
      case 'crop-scale':
      case 'crop-frame': {
        endGesture();
        return;
      }
      case 'crop-rotate': {
        setRotationDisplay(null);
        endGesture();
        return;
      }
      case 'bend-arrow': {
        endGesture();
        return;
      }
    }
  };

  /**
   * Topmost shape whose geometric interior contains the point — used for
   * double-click-to-type, so transparent shapes still accept text.
   */
  const shapeInteriorAt = (x: number, y: number): SketchElement | null => {
    const els = getElements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.locked) continue;
      if (isInsideLockedFrame(el, els)) continue;
      if (hiddenByClip(el, x, y, els)) continue;
      const [lx, ly] = toLocalPoint(el, x, y);
      const b = getBounds(el);
      if (!pointInBounds(lx, ly, b)) continue;
      if (el.type === 'rectangle' || el.type === 'sticky') return el;
      if (el.type === 'ellipse') {
        const dx = (lx - (b.x + b.w / 2)) / Math.max(b.w / 2, 0.001);
        const dy = (ly - (b.y + b.h / 2)) / Math.max(b.h / 2, 0.001);
        if (dx * dx + dy * dy <= 1) return el;
      }
      if (el.type === 'diamond') {
        const dx = Math.abs(lx - (b.x + b.w / 2)) / Math.max(b.w / 2, 0.001);
        const dy = Math.abs(ly - (b.y + b.h / 2)) / Math.max(b.h / 2, 0.001);
        if (dx + dy <= 1) return el;
      }
      if (el.type === 'triangle') {
        // Half-width shrinks linearly from base (bottom) to apex (top).
        const t = (ly - b.y) / Math.max(b.h, 0.001);
        if (t >= 0 && t <= 1 && Math.abs(lx - (b.x + b.w / 2)) <= (b.w / 2) * t) return el;
      }
    }
    return null;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (stateRef.current.tool !== 'select') return;
    const [px, py] = toPage(e.clientX, e.clientY);
    let hit = selectableAt(px, py) ?? shapeInteriorAt(px, py);
    // A transparent shape's interior beats the frame beneath it: double-click
    // should edit the shape's text, not rename the containing frame.
    if (hit?.type === 'frame') {
      const interior = shapeInteriorAt(px, py);
      if (interior) hit = interior;
    }
    if (hit) {
      if (hit.type === 'image') {
        // Enter non-destructive crop mode (Fix 1.43).
        setSelection([hit.id]);
        setCropId(hit.id);
        return;
      }
      if (hit.type === 'text' || hit.type === 'sticky' || isTextContainer(hit)) {
        beginTextEdit(hit.id, false);
        return;
      }
      if (hit.type === 'arrow' || hit.type === 'frame') {
        beginTextEdit(hit.id, false, 'label');
        return;
      }
      return;
    }
    // Double-click on empty paper creates a text element.
    startGesture();
    const d = stateRef.current.defaults;
    const el = baseElement('text', px, py - d.fontSize * 0.65);
    el.text = '';
    el.fontSize = d.fontSize;
    el.textAlign = d.textAlign;
    el.textColor = d.textColor;
    const m = measureText('', el.fontSize);
    el.width = m.w;
    el.height = m.h;
    updateElements([...getElements(), el], false);
    beginTextEdit(el.id, true);
  };

  const updateHoverCursor = (clientX: number, clientY: number, px: number, py: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if (clientX - rect.left < RULER || clientY - rect.top < RULER) {
      setCursor('default');
      return;
    }
    if (spaceDownRef.current) {
      setCursor('grab');
      return;
    }
    const t = stateRef.current.tool;
    if (t === 'select') {
      {
        const rz = cropIdRef.current ? rotateZoneAt(clientX, clientY) : null;
        if (rz) {
          setCursor(ROTATE_CURSORS[rz]);
          return;
        }
      }
      const hit = selectableAt(px, py);
      setHoveredId(hit ? hit.id : null);
      const badge = linkBadgeAt(px, py);
      if (badge) {
        setCursor('pointer');
        const v = stateRef.current.view;
        const [bx, by] = linkBadgeCenter(badge);
        setLinkTip({ x: bx * v.zoom + v.offsetX, y: by * v.zoom + v.offsetY - 30 });
        return;
      }
      setLinkTip(null);
      if (rotateHandleAt(clientX, clientY)) {
        setCursor('grab');
        return;
      }
      if (endpointAt(clientX, clientY) !== null) {
        setCursor('pointer');
        return;
      }
      if (cornerRadiusHandleAt(clientX, clientY)) {
        setCursor('pointer');
        return;
      }
      if (bendHandleAt(clientX, clientY)) {
        setCursor('pointer');
        return;
      }
      const h = handleAt(clientX, clientY);
      if (h && !singleLinearSelected()) {
        setCursor(HANDLE_CURSORS[h]);
        return;
      }
      {
        const rz = rotateZoneAt(clientX, clientY);
        if (rz) {
          setCursor(ROTATE_CURSORS[rz]);
          return;
        }
      }
      setCursor(hit ? 'move' : 'default');
      return;
    }
    setLinkTip(null);
    if (t === 'text') {
      setCursor('text');
      return;
    }
    if (t === 'eraser') {
      setCursor('cell');
      return;
    }
    if (t === 'embed') {
      setCursor('default');
      return;
    }
    setCursor('crosshair');
  };

  /* ------------------------------- wheel / keys ------------------------------ */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      // While the context menu is open, the canvas must not zoom or pan;
      // wheel input may still scroll the menu internally.
      if (ctxMenuOpenRef.current) {
        if (!(e.target instanceof Node && ctxMenuRef.current?.contains(e.target))) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = container.getBoundingClientRect();
        zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.012));
      } else {
        setView((v) => ({ ...v, offsetX: v.offsetX - e.deltaX, offsetY: v.offsetY - e.deltaY }));
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      if (!spaceDownRef.current) {
        spaceDownRef.current = true;
        setCursor('grab');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDownRef.current = false;
      setCursor('default');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* --------------------------------- drop ----------------------------------- */

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) {
      onInsertImageFiles(files, toPage(e.clientX, e.clientY));
    }
  };

  /* -------------------------------- rendering -------------------------------- */

  const scheduleRedraw = useCallback(() => setRedrawTick((t) => t + 1), []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext('2d')!;
    const { zoom, offsetX, offsetY } = view;
    const infinite = isInfinitePage(page);
    const { w, h } = pageSize(page);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (infinite) {
      // Freeform canvas: a light desk so white frames/artboards stand out.
      ctx.fillStyle = '#eceef1';
      ctx.fillRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#101013';
      ctx.fillRect(0, 0, cw, ch);

      // Paper shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 34;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(offsetX, offsetY, w * zoom, h * zoom);
      ctx.restore();
    }

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offsetX, dpr * offsetY);

    // Skip rendering the text of the element currently being edited.
    let renderPage = page;
    if (editing) {
      renderPage = {
        ...page,
        elements: page.elements.map((el) =>
          el.id === editing.id ? (editing.kind === 'label' ? { ...el, label: '' } : { ...el, text: '' }) : el
        ),
      };
    }
    if (infinite) {
      for (const el of renderPage.elements) {
        renderElementClipped(ctx, el, renderPage.elements, scheduleRedraw, 12 / zoom);
      }
    } else {
      // Frames are artboards: they and their contents render UNCLIPPED so a
      // frame beside/overlapping the page stays fully visible (Fix 1.18 §2).
      const frameIds = renderPage.elements.filter((el) => el.type === 'frame').map((el) => el.id);
      if (frameIds.length > 0) {
        const frameSet = withFrameContents(renderPage.elements, frameIds);
        renderPageContents(
          ctx,
          { ...renderPage, elements: renderPage.elements.filter((el) => !frameSet.has(el.id)) },
          scheduleRedraw
        );
        for (const el of renderPage.elements) {
          if (frameSet.has(el.id)) renderElementClipped(ctx, el, renderPage.elements, scheduleRedraw, 12 / zoom);
        }
      } else {
        renderPageContents(ctx, renderPage, scheduleRedraw);
      }
    }

    // In-progress element previews can extend past the paper edge; draw the
    // active element again unclipped so the user sees what they're dragging.
    const action = actionRef.current;
    if (!infinite && action && (action.type === 'draw' || action.type === 'draw-linear' || action.type === 'pencil')) {
      const el = page.elements.find((x) => x.id === action.id);
      if (el) renderElement(ctx, el, scheduleRedraw);
    }
    if (action?.type === 'draw-text') {
      // Preview the text box being dragged out — solid, like the editor
      // outline it becomes (Fix 1.35: dashes are for the marquee only).
      const el = page.elements.find((x) => x.id === action.id);
      if (el) {
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.25 / zoom;
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
    }

    /* selection decorations (page space, screen-constant line widths) */
    const lw = 1.25 / zoom;
    // While text-editing, the editor overlay's solid outline IS the visual
    // state — no handles or selection frame on the edited element (Fix 1.35).
    const editingTextId = editing?.kind === 'text' ? editing.id : null;
    const selEls = page.elements.filter(
      (el) => selection.includes(el.id) && el.id !== editingTextId && el.id !== cropId
    );
    if (selEls.length > 0) {
      const linear =
        selEls.length === 1 &&
        (selEls[0].type === 'line' || selEls[0].type === 'arrow') &&
        selEls[0].points?.length === 2
          ? selEls[0]
          : null;

      // Multi-selection: a mild blue outline on every member (Fix 1.44.2),
      // following the actual shape/mask/linear path — indicators only, no
      // handles. Drawn first so the main group box stays on top.
      if (selEls.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(24, 155, 255, 0.65)';
        ctx.lineWidth = 1 / zoom;
        for (const mel of selEls) {
          ctx.save();
          if (mel.rotation && (!mel.points || mel.points.length === 0)) {
            const mb = getBounds(mel);
            const [mcx2, mcy2] = boundsCenter(mb);
            ctx.translate(mcx2, mcy2);
            ctx.rotate(rotationRad(mel));
            ctx.translate(-mcx2, -mcy2);
          }
          elementOutlinePath(ctx, mel);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }

      // Editing frame: single elements use their own (possibly rotated) frame.
      const frameB = selEls.length === 1 ? getBounds(selEls[0]) : boundsUnion(selEls.map(getAABB));
      const frameRot = selEls.length === 1 ? rotationRad(selEls[0]) : 0;
      const [fcx, fcy] = boundsCenter(frameB);

      ctx.save();
      if (frameRot) {
        ctx.translate(fcx, fcy);
        ctx.rotate(frameRot);
        ctx.translate(-fcx, -fcy);
      }
      if (linear) {
        for (const [hx, hy] of absPoints(linear)) {
          ctx.beginPath();
          ctx.arc(hx, hy, 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = ACCENT;
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = lw;
        ctx.strokeRect(frameB.x, frameB.y, frameB.w, frameB.h);

        const positions = handlePositions(frameB);
        const s = HANDLE_SCREEN_SIZE / zoom;
        const visibleHandles = selEls.length > 1 ? CORNER_HANDLES : HANDLES;
        for (const hKey of visibleHandles) {
          const [hx, hy] = positions[hKey];
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
          ctx.strokeRect(hx - s / 2, hy - s / 2, s, s);
        }
      }
      if (selEls.length === 1) {
        // Rotation handle: stem + circular dot above the frame's top-center.
        const topCx = frameB.x + frameB.w / 2;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(topCx, frameB.y - 8 / zoom);
        ctx.lineTo(topCx, frameB.y - 20 / zoom);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(topCx, frameB.y - 26 / zoom, 5.5 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      if (!editing) drawSelectionSizeBadge(ctx, frameB, frameRot, zoom);

      // Corner-radius handle: small orange circle inside the shape — also
      // for clipping-mask shapes (Clipmask Fix 1.0).
      if (selEls.length === 1 && radiusShapeOf(selEls[0])) {
        const crEl = selEls[0];
        const crPos = cornerRadiusHandlePos(crEl);
        if (crPos) {
          ctx.save();
          if (crEl.rotation) {
            const crB = getBounds(crEl);
            const [crCx, crCy] = boundsCenter(crB);
            ctx.translate(crCx, crCy);
            ctx.rotate(rotationRad(crEl));
            ctx.translate(-crCx, -crCy);
          }
          ctx.beginPath();
          ctx.arc(crPos[0], crPos[1], 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#f08c00';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Bend-arrow handle: small teal circle on the arrow midpoint or control point.
      if (linear) {
        const bendPos = bendHandlePos(linear);
        if (bendPos) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(bendPos[0], bendPos[1], 5.5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#12b886';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Image crop mode UI (Fix 1.43/1.43.1): full image visible with the
    // outside-crop area dimmed, dotted blue crop boundary with thick blue
    // crop handles, round content-scale handles, and a live size label.
    if (cropId) {
      const cel = page.elements.find((x) => x.id === cropId);
      if (cel && cel.type === 'image') {
        const CROP_BLUE = '#189BFF';
        const c = cropOf(cel);
        const cb = getBounds(cel);
        const contentX = cel.x + c.x;
        const contentY = cel.y + c.y;
        ctx.save();
        if (cel.rotation) {
          const [ccx, ccy] = boundsCenter(cb);
          ctx.translate(ccx, ccy);
          ctx.rotate(rotationRad(cel));
          ctx.translate(-ccx, -ccy);
        }
        // Full image at full opacity, then dim everything outside the kept
        // area, so it reads as a clear window (Fix 1.43.1/1.44.1). The
        // content may carry its own rotation (Fix 1.45.1).
        const img = cel.imageData ? getImage(cel.imageData) : null;
        const crad = cropRotRad(c);
        const cctr: Point = [contentX + c.w / 2, contentY + c.h / 2];
        const rcorners = cropContentCorners(cel, c); // TL, TR, BL, BR (rotated)
        const contentPoly = () => {
          ctx.moveTo(rcorners[0][0], rcorners[0][1]);
          ctx.lineTo(rcorners[1][0], rcorners[1][1]);
          ctx.lineTo(rcorners[3][0], rcorners[3][1]);
          ctx.lineTo(rcorners[2][0], rcorners[2][1]);
          ctx.closePath();
        };
        const drawContentImage = () => {
          if (!img) return;
          if (crad) {
            ctx.save();
            ctx.translate(cctr[0], cctr[1]);
            ctx.rotate(crad);
            ctx.translate(-cctr[0], -cctr[1]);
            ctx.drawImage(img, contentX, contentY, c.w, c.h);
            ctx.restore();
          } else {
            ctx.drawImage(img, contentX, contentY, c.w, c.h);
          }
        };
        if (img) {
          drawContentImage();
          if (cel.mask) {
            // Clipping mask: softly dim ONLY the image content itself (no
            // big gray box — Fix 1.45.2), then re-draw it through the mask
            // path so the actual shape is the clear, bright window.
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.beginPath();
            contentPoly();
            ctx.fill();
            ctx.save();
            maskShapePath(ctx, cel);
            ctx.clip();
            drawContentImage();
            ctx.restore();
          } else {
            ctx.beginPath();
            contentPoly();
            ctx.rect(cb.x, cb.y, cb.w, cb.h);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fill('evenodd');
          }
        }
        // Content bounds: dotted for masked images (the full-image boundary,
        // distinct from the solid mask outline), faint solid otherwise.
        ctx.strokeStyle = cel.mask ? CROP_BLUE : 'rgba(24, 155, 255, 0.55)';
        ctx.lineWidth = 1 / zoom;
        if (cel.mask) ctx.setLineDash([2.5 / zoom, 3 / zoom]);
        ctx.beginPath();
        contentPoly();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [hx, hy] of rcorners) {
          ctx.beginPath();
          ctx.arc(hx, hy, 4.5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = CROP_BLUE;
          ctx.stroke();
        }
        if (cel.mask) {
          // Solid blue outline following the actual mask path (Fix 1.44.1):
          // the triangle/ellipse/… boundary stays prominent while editing.
          maskShapePath(ctx, cel);
          ctx.strokeStyle = CROP_BLUE;
          ctx.lineWidth = 2 / zoom;
          ctx.stroke();
        } else {
          // Dotted blue crop boundary (crop mode only — Fix 1.43.1).
          ctx.strokeStyle = CROP_BLUE;
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([2.5 / zoom, 3 / zoom]);
          ctx.strokeRect(cb.x, cb.y, cb.w, cb.h);
          ctx.setLineDash([]);
        }
        // Thick solid blue crop handles: 8 blocks sitting on the boundary.
        const cpos = handlePositions(cb);
        ctx.fillStyle = CROP_BLUE;
        const cornerS = 13 / zoom;
        const edgeL = 18 / zoom;
        const edgeT = 7 / zoom;
        const rr = 1.5 / zoom;
        const block = (bx: number, by: number, bw: number, bh: number) => {
          ctx.beginPath();
          ctx.moveTo(bx + rr, by);
          ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
          ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
          ctx.arcTo(bx, by + bh, bx, by, rr);
          ctx.arcTo(bx, by, bx + bw, by, rr);
          ctx.closePath();
          ctx.fill();
        };
        for (const hk of HANDLES) {
          const [hx, hy] = cpos[hk];
          if (hk.length === 2) block(hx - cornerS / 2, hy - cornerS / 2, cornerS, cornerS);
          else if (hk === 'n' || hk === 's') block(hx - edgeL / 2, hy - edgeT / 2, edgeL, edgeT);
          else block(hx - edgeT / 2, hy - edgeL / 2, edgeT, edgeL);
        }
        // Live size label below the crop boundary.
        {
          const label = `${cb.w.toFixed(2)} × ${cb.h.toFixed(2)}`;
          ctx.font = `500 ${13 / zoom}px ${FONT_FAMILY}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const tw = ctx.measureText(label).width;
          const padX = 8 / zoom;
          const bh2 = 22 / zoom;
          const lx = cb.x + cb.w / 2;
          const ly = cb.y + cb.h + 18 / zoom;
          const bx = lx - tw / 2 - padX;
          const by = ly - bh2 / 2;
          const r4 = 4 / zoom;
          ctx.fillStyle = CROP_BLUE;
          ctx.beginPath();
          ctx.moveTo(bx + r4, by);
          ctx.arcTo(bx + tw + padX * 2, by, bx + tw + padX * 2, by + bh2, r4);
          ctx.arcTo(bx + tw + padX * 2, by + bh2, bx, by + bh2, r4);
          ctx.arcTo(bx, by + bh2, bx, by, r4);
          ctx.arcTo(bx, by, bx + tw + padX * 2, by, r4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, lx, ly + 0.5 / zoom);
        }
        ctx.restore();
      }
    }

    // Link badges on linked elements that are selected or hovered.
    for (const el of page.elements) {
      if (!el.link) continue;
      if (!selection.includes(el.id) && el.id !== hoveredId) continue;
      const bb = getAABB(el);
      const bx = bb.x + bb.w + 10 / zoom;
      const by = bb.y - 10 / zoom;
      const r = 9 / zoom;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 4 / zoom;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.25 / zoom;
      ctx.stroke();
      // little ↗ glyph
      ctx.strokeStyle = '#1971c2';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(bx - 3 / zoom, by + 3 / zoom);
      ctx.lineTo(bx + 3 / zoom, by - 3 / zoom);
      ctx.moveTo(bx - 0.5 / zoom, by - 3 / zoom);
      ctx.lineTo(bx + 3 / zoom, by - 3 / zoom);
      ctx.lineTo(bx + 3 / zoom, by + 0.5 / zoom);
      ctx.stroke();
      ctx.restore();
    }

    if (bindHighlight) {
      const target = page.elements.find((el) => el.id === bindHighlight);
      if (target) {
        const b = getBounds(target);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.strokeRect(b.x - 6 / zoom, b.y - 6 / zoom, b.w + 12 / zoom, b.h + 12 / zoom);
        ctx.setLineDash([]);
      }
    }

    if (dropFrame) {
      // Solid accent outline + soft glow on the frame that would adopt the
      // dragged elements (Fix 1.37 drag feedback).
      const target = page.elements.find((el) => el.id === dropFrame);
      if (target) {
        const fb = getBounds(target);
        ctx.save();
        const rad = rotationRad(target);
        if (rad) {
          const [tcx, tcy] = boundsCenter(fb);
          ctx.translate(tcx, tcy);
          ctx.rotate(rad);
          ctx.translate(-tcx, -tcy);
        }
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2 / zoom;
        ctx.shadowColor = 'rgba(77, 171, 247, 0.55)';
        ctx.shadowBlur = 10 / zoom;
        ctx.strokeRect(fb.x, fb.y, fb.w, fb.h);
        ctx.restore();
      }
    }

    // Smart alignment guides (Fix 1.41) — overlay only, never exported.
    const guides = guidesRef.current;
    if (guides) {
      ctx.save();
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth = 1 / zoom;
      for (const g of guides.v) {
        ctx.beginPath();
        ctx.moveTo(g.pos, g.a);
        ctx.lineTo(g.pos, g.b);
        ctx.stroke();
      }
      for (const g of guides.h) {
        ctx.beginPath();
        ctx.moveTo(g.a, g.pos);
        ctx.lineTo(g.b, g.pos);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Alt/Option measurement inspection (Fix 1.42): with a selection and
    // Alt held, measure to whatever the cursor hovers — another object
    // (closest-edge gaps + subtle highlight), a hovered frame's edges, or,
    // over empty space, the selection's parent frame. Overlay only.
    if (altHeld && !editing && tool === 'select') {
      const els = page.elements;
      const pp = pointerPageRef.current;
      const threshold = 6 / zoom;
      // Measurement source: the selection — or, with nothing selected, the
      // object under the cursor (pure hover inspection, no click needed).
      let sourceEls = selEls;
      let hoverIsSource = false;
      if (sourceEls.length === 0 && pp) {
        for (let i = els.length - 1; i >= 0; i--) {
          const el = els[i];
          if (el.type === 'frame') continue;
          if (hiddenByClip(el, pp[0], pp[1], els)) continue;
          if (hitTest(el, pp[0], pp[1], threshold)) {
            sourceEls = [el];
            hoverIsSource = true;
            break;
          }
        }
      }
      if (sourceEls.length === 0) {
        // nothing to measure from
      } else {
      const sb = boundsUnion(sourceEls.map(getAABB));
      const selIds = new Set(sourceEls.map((el) => el.id));

      const drawMeasure = (x1: number, y1: number, x2: number, y2: number, val: number) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const label = String(Math.round(val));
        const lx = (x1 + x2) / 2;
        const ly = (y1 + y2) / 2;
        const tw = ctx.measureText(label).width;
        const padX = 4 / zoom;
        const bh = 15 / zoom;
        const bx = lx - tw / 2 - padX;
        const by = ly - bh / 2;
        const bw = tw + padX * 2;
        const r = 3 / zoom;
        ctx.fillStyle = '#FF3B30';
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        ctx.arcTo(bx, by + bh, bx, by, r);
        ctx.arcTo(bx, by, bx + bw, by, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, lx, ly + 0.5 / zoom);
      };

      const drawFrameEdges = (fb: Bounds) => {
        const midX = sb.x + sb.w / 2;
        const midY = sb.y + sb.h / 2;
        drawMeasure(fb.x, midY, sb.x, midY, sb.x - fb.x);
        drawMeasure(sb.x + sb.w, midY, fb.x + fb.w, midY, fb.x + fb.w - (sb.x + sb.w));
        drawMeasure(midX, fb.y, midX, sb.y, sb.y - fb.y);
        drawMeasure(midX, sb.y + sb.h, midX, fb.y + fb.h, fb.y + fb.h - (sb.y + sb.h));
      };

      ctx.save();
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 1 / zoom;
      ctx.font = `600 ${11 / zoom}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Hover target under the cursor: non-source objects first, then frames.
      // When the hover itself is the source, measure it against its frame.
      let hovered: SketchElement | null = null;
      if (pp && !hoverIsSource) {
        for (let i = els.length - 1; i >= 0; i--) {
          const el = els[i];
          if (selIds.has(el.id) || el.type === 'frame') continue;
          if (hiddenByClip(el, pp[0], pp[1], els)) continue;
          if (hitTest(el, pp[0], pp[1], threshold)) {
            hovered = el;
            break;
          }
        }
        if (!hovered) hovered = frameAtPoint(els, pp[0], pp[1]);
      }

      if (hoverIsSource) {
        // Pure hover: outline the source and show its parent-frame gaps.
        ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
        const fid = sourceEls[0].frameId;
        const srcFrame = fid ? els.find((f) => f.id === fid && f.type === 'frame') : null;
        if (srcFrame) drawFrameEdges(getBounds(srcFrame));
      } else if (hovered && hovered.type !== 'frame') {
        // Object-to-object: gaps between closest edges, per axis with a gap.
        const hb = getAABB(hovered);
        ctx.strokeStyle = '#FF3B30';
        ctx.strokeRect(hb.x, hb.y, hb.w, hb.h); // subtle hover highlight
        const yMid = (Math.max(sb.y, hb.y) + Math.min(sb.y + sb.h, hb.y + hb.h)) / 2;
        const xMid = (Math.max(sb.x, hb.x) + Math.min(sb.x + sb.w, hb.x + hb.w)) / 2;
        const gapRight = hb.x - (sb.x + sb.w);
        const gapLeft = sb.x - (hb.x + hb.w);
        const gapBelow = hb.y - (sb.y + sb.h);
        const gapAbove = sb.y - (hb.y + hb.h);
        if (gapRight > 0) drawMeasure(sb.x + sb.w, yMid, hb.x, yMid, gapRight);
        else if (gapLeft > 0) drawMeasure(hb.x + hb.w, yMid, sb.x, yMid, gapLeft);
        if (gapBelow > 0) drawMeasure(xMid, sb.y + sb.h, xMid, hb.y, gapBelow);
        else if (gapAbove > 0) drawMeasure(xMid, hb.y + hb.h, xMid, sb.y, gapAbove);
      } else if (hovered) {
        // Hovering a frame (its empty area or edge): measure to its edges —
        // this covers the parent frame when the cursor is inside it.
        drawFrameEdges(getBounds(hovered));
      } else if (pp) {
        // Empty canvas: fall back to the parent frame, when there is one.
        const fid = sourceEls.find((el) => el.type !== 'frame')?.frameId;
        const mFrame = fid ? els.find((f) => f.id === fid && f.type === 'frame') : null;
        if (mFrame) drawFrameEdges(getBounds(mFrame));
      }
      ctx.restore();
      }
    }

    if (marquee) {
      ctx.fillStyle = 'rgba(77, 171, 247, 0.08)';
      ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = lw;
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
    }

    if (action?.type === 'lasso' && action.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(action.points[0][0], action.points[0][1]);
      for (const [lx, ly] of action.points) ctx.lineTo(lx, ly);
      ctx.closePath();
      ctx.fillStyle = 'rgba(77, 171, 247, 0.07)';
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.25 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Laser pointer trail: newest segments are widest and most opaque.
    const laser = laserRef.current;
    if (laser.length > 1) {
      const now = performance.now();
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < laser.length; i++) {
        const age = now - laser[i].t;
        const life = Math.max(0, 1 - age / 700);
        if (life <= 0) continue;
        ctx.strokeStyle = `rgba(255, 59, 48, ${0.85 * life})`;
        ctx.lineWidth = (1 + 3.5 * life) / zoom;
        ctx.beginPath();
        ctx.moveTo(laser[i - 1].x, laser[i - 1].y);
        ctx.lineTo(laser[i].x, laser[i].y);
        ctx.stroke();
      }
      const head = laser[laser.length - 1];
      ctx.fillStyle = 'rgba(255, 59, 48, 0.9)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Ruler origin: the selected frame's top-left — or, for an object inside
    // a frame, its parent frame — otherwise the global canvas origin (Fix 1.22).
    let rulerFrame: Bounds | null = null;
    if (selEls.length > 0) {
      const primary = selEls[0];
      let frameEl = primary.type === 'frame' ? primary : undefined;
      if (!frameEl && primary.frameId) {
        frameEl = page.elements.find((f) => f.id === primary.frameId && f.type === 'frame');
      }
      if (frameEl) rulerFrame = getBounds(frameEl);
    }
    drawRulers(ctx, dpr, cw, ch, zoom, offsetX, offsetY, rulerFrame);
  });

  // Redraw on container resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => scheduleRedraw());
    obs.observe(container);
    return () => obs.disconnect();
  }, [scheduleRedraw]);

  // Focus the editor as soon as editing begins. The canvas suppresses the
  // default mousedown focus steal, so immediate focus is safe; the rAF pass
  // re-asserts it in case any late default action grabbed focus anyway.
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.value = editingValueRef.current;
      ta.focus();
      ta.select();
      const raf = requestAnimationFrame(() => {
        if (document.activeElement !== ta) {
          ta.focus();
          ta.select();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [editing]);

  /* ------------------------------ editor overlay ----------------------------- */

  let editorNode = null;
  if (editing) {
    const el = page.elements.find((x) => x.id === editing.id);
    if (el) {
      const { zoom, offsetX, offsetY } = view;
      const b = getBounds(el);
      let style: React.CSSProperties;
      if (editing.kind === 'label' && el.type === 'frame') {
        // Frame rename: editor sits on the name label above the frame.
        style = {
          left: b.x * zoom + offsetX,
          top: (b.y - 22) * zoom + offsetY,
          width: Math.max(160, Math.min(260, b.w * zoom)),
          height: 24,
          fontSize: 13,
          textAlign: 'left',
          background: 'rgba(35, 35, 41, 0.95)',
          color: '#e9e9ef',
        };
      } else if (editing.kind === 'label') {
        const pts = absPoints(el);
        const mx = (pts[0][0] + pts[pts.length - 1][0]) / 2;
        const my = (pts[0][1] + pts[pts.length - 1][1]) / 2;
        style = {
          left: mx * zoom + offsetX - 70,
          top: my * zoom + offsetY - 14,
          width: 140,
          height: 28,
          fontSize: 14 * zoom,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.95)',
          color: textColorOf(el),
        };
      } else if (el.type === 'sticky') {
        style = {
          left: b.x * zoom + offsetX + 8 * zoom,
          top: b.y * zoom + offsetY + 8 * zoom,
          width: (b.w - 16) * zoom,
          height: (b.h - 16) * zoom,
          fontSize: (el.fontSize ?? 16) * zoom,
          textAlign: el.textAlign ?? 'left',
          background: 'transparent',
          color: textColorOf(el),
        };
      } else if (isTextContainer(el)) {
        // Contained shape text: editor sits over the padded text area and
        // tracks vertical centering as the user types.
        const area = getTextArea(el);
        const fontSize = el.fontSize ?? 16;
        const contentH = Math.max(
          textBlockHeight(editingValueRef.current || ' ', fontSize, area.w),
          fontSize * LINE_HEIGHT
        );
        const top = area.y + Math.max(0, (area.h - contentH) / 2);
        style = {
          left: area.x * zoom + offsetX,
          top: top * zoom + offsetY,
          width: area.w * zoom,
          height: Math.max(contentH, Math.min(area.h, contentH + fontSize)) * zoom,
          fontSize: fontSize * zoom,
          textAlign: el.textAlign ?? 'center',
          background: 'transparent',
          color: textColorOf(el),
        };
      } else if (el.type === 'text' && el.boxed) {
        // Fixed-width box: the editor exactly matches the rendered layout
        // (same width, padding, and content-hugged height) — no jump on exit.
        const area = getTextArea(el);
        const fontSize = el.fontSize ?? 20;
        const contentH = Math.max(
          textBlockHeight(editingValueRef.current || ' ', fontSize, area.w),
          fontSize * LINE_HEIGHT
        );
        style = {
          left: area.x * zoom + offsetX,
          top: area.y * zoom + offsetY,
          width: area.w * zoom,
          height: contentH * zoom + 2,
          fontSize: fontSize * zoom,
          textAlign: el.textAlign ?? 'left',
          background: 'transparent',
          color: textColorOf(el),
        };
      } else {
        // Auto-width text never wraps: the box hugs the longest line live.
        const fontSize = el.fontSize ?? 20;
        style = {
          left: b.x * zoom + offsetX,
          top: b.y * zoom + offsetY,
          width: Math.max(30, b.w * zoom + 8),
          height: Math.max(fontSize * LINE_HEIGHT, b.h) * zoom + 2,
          fontSize: fontSize * zoom,
          textAlign: el.textAlign ?? 'left',
          background: 'transparent',
          color: textColorOf(el),
          whiteSpace: 'pre',
        };
      }
      if (el.rotation && editing.kind === 'text') {
        // Simplified rotated-edit mode: rotate the overlay with the element.
        style.transform = `rotate(${el.rotation}deg)`;
        style.transformOrigin = 'center center';
      }
      editorNode = (
        <textarea
          ref={textareaRef}
          className="canvas-text-editor"
          style={{ ...style, fontFamily: FONT_FAMILY, lineHeight: 1.3 }}
          defaultValue={editingValueRef.current}
          onInput={(e) => {
            const value = (e.target as HTMLTextAreaElement).value;
            editingValueRef.current = value;
            // Standalone text hugs its content LIVE while typing (Fix 1.8):
            // the element's box updates on every keystroke inside the edit
            // gesture, so the selection frame grows/shrinks with the text.
            const ed = stateRef.current.editing;
            if (ed?.kind === 'text') {
              const els = getElements();
              const target = els.find((x) => x.id === ed.id);
              if (target?.type === 'text') {
                let hugged: SketchElement;
                if (target.boxed) {
                  hugged = { ...target, text: value };
                  hugged.height = hugBoxedTextHeight(hugged);
                } else {
                  const m = measureText(value, target.fontSize ?? 20);
                  hugged = { ...target, text: value, width: m.w, height: m.h };
                }
                updateElements(els.map((x) => (x.id === ed.id ? hugged : x)), false);
              }
            }
            // Re-render so the editor tracks size/centering while typing.
            setRedrawTick((t) => t + 1);
          }}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Cmd/Ctrl+Shift+> / < adjusts the active text's font size while
            // editing (whole-object; no rich text) — Fix 1.23.
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.shiftKey && (e.key === '>' || e.key === '<' || e.code === 'Period' || e.code === 'Comma')) {
              e.preventDefault();
              const delta = e.key === '>' || e.code === 'Period' ? 1 : -1;
              const ed = stateRef.current.editing;
              if (ed?.kind === 'text') {
                const els = getElements();
                updateElements(
                  els.map((x) => {
                    if (x.id !== ed.id) return x;
                    const base = x.fontSize ?? (x.type === 'text' ? 20 : 16);
                    const fontSize = Math.min(120, Math.max(8, base + delta));
                    if (fontSize === base) return x;
                    let next: SketchElement = { ...x, fontSize, text: editingValueRef.current };
                    if (x.type === 'text' && x.boxed) {
                      next.height = hugBoxedTextHeight(next, editingValueRef.current);
                    } else if (x.type === 'text') {
                      const m = measureText(editingValueRef.current, fontSize);
                      next = { ...next, width: m.w, height: m.h };
                    } else {
                      next = ensureTextFits(next);
                    }
                    return next;
                  }),
                  false
                );
                setRedrawTick((t) => t + 1);
              }
              return;
            }
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              if (e.key === 'Escape' && editing.kind === 'label') {
                // Escape cancels a rename instead of saving it (Fix 1.18 §3).
                editingValueRef.current = editing.original;
              }
              commitEditing();
            }
            if (e.key === 'Enter' && editing.kind === 'label') {
              e.preventDefault();
              commitEditing();
            }
          }}
        />
      );
    }
  }

  /* --------------------------------- layout ---------------------------------- */

  const { w: pw, h: ph } = pageSize(page);
  const addBtnLeft = view.offsetX + (pw * view.zoom) / 2;
  const addBtnTop = view.offsetY + ph * view.zoom + 14;

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onMouseDown={(e) => {
          // The default mousedown action moves focus (blurring a text editor
          // opened during pointerdown) — suppress it; we manage focus ourselves.
          e.preventDefault();
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body && active.tagName !== 'TEXTAREA') {
            active.blur();
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          pointerPageRef.current = null;
          if (altHeldRef.current) setRedrawTick((t) => t + 1);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          // Right-click is pan (Fix 1.27); the frame context menu opens from
          // pointerup when the button is released without dragging.
          e.preventDefault();
        }}
      />
      {rotationDisplay && (
        <div className="rotation-readout" style={{ left: rotationDisplay.x, top: rotationDisplay.y }}>
          {rotationDisplay.deg}°
        </div>
      )}
      {linkTip && (
        <div className="link-tooltip" style={{ left: linkTip.x, top: linkTip.y }}>
          Open link
        </div>
      )}
      {ctxMenu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="Context menu"
          ref={ctxMenuRef}
          style={{ left: ctxMenu.x, top: ctxMenu.y, visibility: 'hidden' }}
          onContextMenu={(ev) => ev.preventDefault()}
        >
          {ctxMenu.items.map((item, i) =>
            item === 'div' ? (
              <div key={`d${i}`} className="menu-divider" role="separator" />
            ) : (
              <button
                key={`${item.label}${i}`}
                role="menuitem"
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                className={`menu-item ${item.danger ? 'danger' : ''} ${ctxActive === i ? 'kb-active' : ''}`}
                onMouseEnter={() => setCtxActive(i)}
                onClick={() => {
                  setCtxMenu(null);
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="menu-shortcut">{item.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
      {page.elements
        .filter((el) => el.type === 'frame' && el.locked)
        .map((frame) => {
          const fb = getBounds(frame);
          const { zoom, offsetX, offsetY } = view;
          const x = (fb.x + fb.w) * zoom + offsetX - 12;
          const y = fb.y * zoom + offsetY - 12;
          const container = containerRef.current;
          if (
            container &&
            (x < -32 || y < -32 || x > container.clientWidth + 32 || y > container.clientHeight + 32)
          ) {
            return null;
          }
          return (
            <button
              key={`unlock-${frame.id}`}
              className="frame-unlock-btn"
              style={{ left: x, top: y }}
              title="Unlock frame"
              aria-label="Unlock frame"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                unlockFrame(frame.id);
              }}
            >
              {Icons.lock}
            </button>
          );
        })}
      {(() => {
        // Ghost plus buttons around a selected frame: click creates a blank
        // matching frame in that direction; Alt+click duplicates with
        // contents (Fix 1.20).
        if (tool !== 'select' || editing || selection.length !== 1 || actionRef.current) return null;
        const frame = page.elements.find((el) => el.id === selection[0] && el.type === 'frame');
        if (!frame || frame.locked) return null;
        const fb = getBounds(frame);
        const { zoom, offsetX, offsetY } = view;
        const cxs = (fb.x + fb.w / 2) * zoom + offsetX;
        const cys = (fb.y + fb.h / 2) * zoom + offsetY;
        const spots: { dir: 'top' | 'bottom' | 'left' | 'right'; x: number; y: number; label: string }[] = [
          { dir: 'top', x: cxs, y: fb.y * zoom + offsetY - 40, label: 'Add frame above' },
          { dir: 'bottom', x: cxs, y: (fb.y + fb.h) * zoom + offsetY + 40, label: 'Add frame below' },
          { dir: 'left', x: fb.x * zoom + offsetX - 40, y: cys, label: 'Add frame left' },
          { dir: 'right', x: (fb.x + fb.w) * zoom + offsetX + 40, y: cys, label: 'Add frame right' },
        ];
        return spots.map((sp) => (
          <button
            key={sp.dir}
            className="ghost-plus"
            style={{ left: sp.x, top: sp.y }}
            title={`${sp.label} (Alt: duplicate with contents)`}
            aria-label={sp.label}
            onClick={(e) => addFrameDirectional(frame, sp.dir, e.altKey)}
          >
            +
          </button>
        ));
      })()}
      {!isInfinitePage(page) && (
        <button
          className="add-page-float"
          style={{ left: addBtnLeft, top: addBtnTop }}
          onClick={onAddPage}
          title="Add page"
        >
          +
        </button>
      )}
      {tool === 'frame' && (
        <div className="frame-presets" role="dialog" aria-label="Frame presets">
          <div className="frame-presets-header">
            <span className="frame-presets-hint">Drag to draw a frame, or pick a preset:</span>
            <button
              className="frame-presets-close"
              type="button"
              aria-label="Close frame presets"
              title="Close"
              onClick={() => setTool('select')}
            >
              ×
            </button>
          </div>
          <div className="frame-presets-row">
            {FRAME_PRESETS.map((fp) => (
              <button
                key={fp.label}
                className="chip"
                title={`${fp.label} — ${fp.w} × ${fp.h} px`}
                onClick={() => createPresetFrame(fp)}
              >
                {fp.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {tool === 'embed' && (
        <div className="embed-prompt" role="dialog" aria-label="Add web embed">
          <span className="embed-prompt-icon">🌐</span>
          <input
            autoFocus
            type="text"
            value={embedUrl}
            placeholder="Type or paste your link here"
            spellCheck={false}
            onChange={(e) => setEmbedUrl(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') createEmbed();
              if (e.key === 'Escape') setTool('select');
            }}
          />
          <button className="toolbar-btn primary" onClick={createEmbed}>
            Embed
          </button>
        </div>
      )}
      {editorNode}
    </div>
  );
});

/* ---------------------------------- helpers ---------------------------------- */

function handlePositions(b: Bounds): Record<Handle, Point> {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return {
    nw: [b.x, b.y],
    n: [cx, b.y],
    ne: [b.x + b.w, b.y],
    e: [b.x + b.w, cy],
    se: [b.x + b.w, b.y + b.h],
    s: [cx, b.y + b.h],
    sw: [b.x, b.y + b.h],
    w: [b.x, cy],
  };
}

function drawBounds(startX: number, startY: number, px: number, py: number, constrained: boolean): Bounds {
  if (!constrained) return normalizeRect(startX, startY, px, py);
  const dx = px - startX;
  const dy = py - startY;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: dx < 0 ? startX - size : startX,
    y: dy < 0 ? startY - size : startY,
    w: size,
    h: size,
  };
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawSelectionSizeBadge(ctx: CanvasRenderingContext2D, b: Bounds, rot: number, zoom: number) {
  if (!Number.isFinite(b.w) || !Number.isFinite(b.h)) return;
  const label = `${Math.abs(b.w).toFixed(2)} × ${Math.abs(b.h).toFixed(2)}`;
  const fontSize = 8 / zoom;
  const padX = 4 / zoom;
  const padY = 1.5 / zoom;
  const height = 13 / zoom;
  const gap = 5 / zoom;
  const center = boundsCenter(b);
  let anchor: Point = [b.x + b.w / 2, b.y + b.h + gap + height / 2];
  if (rot) anchor = rotatePoint(anchor, center, rot);

  ctx.save();
  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width + padX * 2;
  const x = anchor[0] - width / 2;
  const y = anchor[1] - height / 2;

  ctx.fillStyle = '#1e9bf0';
  roundedRectPath(ctx, x, y, width, height, 2.5 / zoom);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, anchor[0], anchor[1] + padY * 0.15);
  ctx.restore();
}

/** Pick a labeled tick step (in page pt) so labels stay ~60px+ apart on screen. */
function rulerStep(zoom: number): number {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (step * zoom >= 56) return step;
  }
  return 1000;
}

function drawRulers(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  cw: number,
  ch: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
  frameOrigin: Bounds | null
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const originX = frameOrigin?.x ?? 0;
  const originY = frameOrigin?.y ?? 0;
  const step = rulerStep(zoom);
  const minor = step / 5;
  const font = '9px -apple-system, "Segoe UI", sans-serif';

  // Backgrounds
  ctx.fillStyle = '#17171b';
  ctx.fillRect(0, 0, cw, RULER);
  ctx.fillRect(0, 0, RULER, ch);
  // Highlight the selected frame's extent (0 → width / height).
  if (frameOrigin) {
    ctx.fillStyle = 'rgba(77, 171, 247, 0.18)';
    ctx.fillRect(originX * zoom + offsetX, 0, frameOrigin.w * zoom, RULER);
    ctx.fillRect(0, originY * zoom + offsetY, RULER, frameOrigin.h * zoom);
  }

  ctx.strokeStyle = '#3a3a44';
  ctx.fillStyle = '#8d8d98';
  ctx.font = font;
  ctx.lineWidth = 1;

  // Horizontal ruler — ticks anchored to the origin so 0 sits exactly at the
  // selected frame's left edge; values are origin-relative.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.beginPath();
  let zeroSX: number | null = null;
  const iStartX = Math.floor(((RULER - offsetX) / zoom - originX) / minor);
  for (let i = iStartX; ; i++) {
    const wx = originX + i * minor;
    const sx = Math.round(wx * zoom + offsetX) + 0.5;
    if (sx > cw) break;
    if (sx < RULER) continue;
    const major = i % 5 === 0;
    if (i === 0 && frameOrigin) {
      zeroSX = sx;
    } else {
      ctx.moveTo(sx, RULER);
      ctx.lineTo(sx, major ? RULER - 9 : RULER - 4);
    }
    if (major) ctx.fillText(String(Math.round(i * minor)), sx + 3, RULER - 11);
  }
  ctx.stroke();

  // Vertical ruler (labels rotated to read upward)
  ctx.beginPath();
  let zeroSY: number | null = null;
  const iStartY = Math.floor(((RULER - offsetY) / zoom - originY) / minor);
  for (let i = iStartY; ; i++) {
    const wy = originY + i * minor;
    const sy = Math.round(wy * zoom + offsetY) + 0.5;
    if (sy > ch) break;
    if (sy < RULER) continue;
    const major = i % 5 === 0;
    if (i === 0 && frameOrigin) {
      zeroSY = sy;
    } else {
      ctx.moveTo(RULER, sy);
      ctx.lineTo(major ? RULER - 9 : RULER - 4, sy);
    }
    if (major) {
      ctx.save();
      ctx.translate(RULER - 11, sy - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(i * minor)), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();

  // Emphasized 0 marks at the frame origin.
  if (zeroSX !== null || zeroSY !== null) {
    ctx.strokeStyle = '#4dabf7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (zeroSX !== null) {
      ctx.moveTo(zeroSX, RULER);
      ctx.lineTo(zeroSX, RULER - 12);
    }
    if (zeroSY !== null) {
      ctx.moveTo(RULER, zeroSY);
      ctx.lineTo(RULER - 12, zeroSY);
    }
    ctx.stroke();
  }

  // Corner + borders
  ctx.fillStyle = '#17171b';
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.strokeStyle = '#2e2e36';
  ctx.beginPath();
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(cw, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, ch);
  ctx.stroke();
}

function resizeBounds(
  ob: Bounds,
  handle: Handle,
  px: number,
  py: number,
  shiftKey = false,
  altKey = false,
  lockRatio = false
): Bounds {
  const MIN = 10;
  const proportional = handle.length === 2 && (shiftKey || altKey || lockRatio);
  const ow = Math.max(ob.w, 0.001);
  const oh = Math.max(ob.h, 0.001);

  if (lockRatio && handle.length === 1) {
    // Side handle with the aspect-ratio lock on: the dragged axis sets a
    // uniform scale, anchored at the opposite side and centered crosswise.
    let s: number;
    if (handle === 'e') s = (px - ob.x) / ow;
    else if (handle === 'w') s = (ob.x + ob.w - px) / ow;
    else if (handle === 's') s = (py - ob.y) / oh;
    else s = (ob.y + ob.h - py) / oh;
    s = Math.max(s, MIN / ow, MIN / oh);
    const w = ow * s;
    const h = oh * s;
    if (handle === 'e') return { x: ob.x, y: ob.y + oh / 2 - h / 2, w, h };
    if (handle === 'w') return { x: ob.x + ow - w, y: ob.y + oh / 2 - h / 2, w, h };
    if (handle === 's') return { x: ob.x + ow / 2 - w / 2, y: ob.y, w, h };
    return { x: ob.x + ow / 2 - w / 2, y: ob.y + oh - h, w, h };
  }

  if (proportional && altKey) {
    // Existing center-based proportional resize behavior, now also used by
    // Alt/Option+Shift. The dominant pointer axis sets the uniform scale.
    const cx = ob.x + ob.w / 2;
    const cy = ob.y + ob.h / 2;
    let s = Math.max(Math.abs(px - cx) / (ow / 2), Math.abs(py - cy) / (oh / 2));
    s = Math.max(s, MIN / ow, MIN / oh);
    const w = ow * s;
    const h = oh * s;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  if (proportional) {
    const signX = handle.includes('e') ? 1 : -1;
    const signY = handle.includes('s') ? 1 : -1;
    const anchorX = signX === 1 ? ob.x : ob.x + ob.w;
    const anchorY = signY === 1 ? ob.y : ob.y + ob.h;
    let s = Math.max(Math.abs(px - anchorX) / ow, Math.abs(py - anchorY) / oh);
    s = Math.max(s, MIN / ow, MIN / oh);
    const w = ow * s;
    const h = oh * s;
    const x = signX === 1 ? anchorX : anchorX - w;
    const y = signY === 1 ? anchorY : anchorY - h;
    return { x, y, w, h };
  }

  let x1 = ob.x;
  let y1 = ob.y;
  let x2 = ob.x + ob.w;
  let y2 = ob.y + ob.h;
  if (handle.includes('w')) x1 = Math.min(px, x2 - MIN);
  if (handle.includes('e')) x2 = Math.max(px, x1 + MIN);
  if (handle === 'n' || handle === 'nw' || handle === 'ne') y1 = Math.min(py, y2 - MIN);
  if (handle === 's' || handle === 'sw' || handle === 'se') y2 = Math.max(py, y1 + MIN);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
