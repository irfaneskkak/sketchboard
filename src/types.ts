export type Tool =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'pencil'
  | 'text'
  | 'sticky'
  | 'image'
  | 'eraser'
  | 'embed'
  | 'laser'
  | 'lasso'
  | 'frame'
  | 'triangle';

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'sticky'
  | 'image'
  | 'embed'
  | 'frame'
  | 'triangle';

export type Point = [number, number];

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
export type Orientation = 'portrait' | 'landscape';

export interface SketchElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string; // 'transparent' means no fill
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number; // 0..100
  seed: number;
  locked: boolean;
  groupId: string | null;
  /** Arrowhead placement (Arrowhead fix): absent = 'end' for arrows and
   * 'none' for lines. */
  arrowHead?: ArrowHead;
  /** Persistent frame membership (Fix 1.39): set from the pointer position
   * while dragging, at creation, or by migration. null = top-level. */
  frameId?: string | null;
  /** Non-destructive image crop (Fix 1.43): where the full image content
   * draws, relative to the element's top-left. The element box is the
   * visible mask. Absent/null = content exactly fills the box.
   * `rotation` (Fix 1.45.1) spins the content about its own center, in
   * degrees, independent of the element/mask rotation. */
  crop?: { x: number; y: number; w: number; h: number; rotation?: number } | null;
  /** Clipping mask (Fix 1.44): clip this image to a shape spanning the
   * element box instead of the plain rectangle. The mask remembers the
   * donor shape's style so releasing restores it. */
  mask?: {
    type: 'rectangle' | 'ellipse' | 'diamond' | 'triangle';
    cornerRadius?: number;
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
  } | null;
  /**
   * Rotation in degrees around the bounding-box center. Linear elements
   * (line/arrow/freedraw) bake rotation into their points instead.
   */
  rotation?: number;
  /** Attached hyperlink (opened via the canvas badge; clickable in PDF/SVG). */
  link?: string;
  /** line / arrow / freedraw: points relative to (x, y) */
  points?: Point[];
  /** arrow bindings: ids of shape elements the endpoints attach to */
  startBinding?: string | null;
  endBinding?: string | null;
  /** arrow midpoint label */
  label?: string;
  /**
   * text / sticky — and rectangle / ellipse / diamond, which can carry
   * contained text (centered, padded, wrapped inside the shape).
   */
  text?: string;
  fontSize?: number;
  textAlign?: TextAlign;
  /** independent text color; falls back to strokeColor for older documents */
  textColor?: string;
  /**
   * Contained text picks black/white automatically from the fill's luminance.
   * Undefined means enabled; set to false once the user picks a color manually.
   */
  autoTextContrast?: boolean;
  /** text elements only: fixed-width text box; text wraps and the box keeps its width */
  boxed?: boolean;
  /** image: data URL */
  imageData?: string;
  /** embed: the linked URL shown on the placeholder card */
  url?: string;
  /** Corner rounding radius for rectangle / diamond shapes (0 = sharp). */
  cornerRadius?: number;
  /** Per-paint opacity (0–100, default 100) and visibility (default true) —
   * the compact Fill/Stroke rows toggle these without losing the color. */
  fillOpacity?: number;
  strokeOpacity?: number;
  fillVisible?: boolean;
  strokeVisible?: boolean;
  /** Quadratic Bézier control point for curved arrows/lines, relative to (x, y). */
  controlPoint?: Point | null;
  /** Whether an arrow/line is straight or curved. */
  arrowType?: 'straight' | 'curved';
}

export interface Page {
  id: string;
  name: string;
  orientation: Orientation;
  elements: SketchElement[];
  /** 'fixed' (default) or 'infinite' freeform canvas (Fix 1.16). */
  canvasType?: 'fixed' | 'infinite';
  /** Preset id the page was created from (e.g. "instagram-post"). */
  canvasPreset?: string;
  /** Fixed-canvas dimensions in px; unset pages fall back to A4 by orientation. */
  width?: number | null;
  height?: number | null;
}

export interface Doc {
  id: string;
  title: string;
  pages: Page[];
  currentPage: number;
}

export type ArrowHead = 'none' | 'start' | 'end' | 'both';

export interface StyleDefaults {
  /** Remembered arrowhead placement for newly drawn arrows (Arrowhead fix). */
  arrowHead?: ArrowHead;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  fontSize: number;
  textAlign: TextAlign;
  stickyColor: string;
  textColor: string;
}

export interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** A4 at 72 DPI (points): 210 x 297 mm */
export const A4 = { w: 595, h: 842 };

export const FONT_FAMILY =
  '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export function pageSize(
  page: Pick<Page, 'orientation'> & Partial<Pick<Page, 'width' | 'height'>>
): { w: number; h: number } {
  if (page.width && page.height) return { w: page.width, h: page.height };
  return page.orientation === 'portrait' ? { w: A4.w, h: A4.h } : { w: A4.h, h: A4.w };
}

export function isInfinitePage(page: Pick<Page, 'canvasType'>): boolean {
  return page.canvasType === 'infinite';
}

let uidCounter = 0;
export function uid(): string {
  uidCounter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${uidCounter.toString(36)}`;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function newPage(index: number, orientation: Orientation = 'portrait'): Page {
  return {
    id: uid(),
    name: `Page ${index}`,
    orientation,
    elements: [],
  };
}

export function newInfinitePage(index: number, name = `Page ${index}`): Page {
  return {
    ...newPage(index),
    name,
    canvasPreset: 'blank-infinite',
    canvasType: 'infinite',
    width: null,
    height: null,
    elements: [],
  };
}

/** The white artboard placed on every frame-based page. */
export function mainFrame(w: number, h: number, label: string): SketchElement {
  return {
    id: uid(),
    type: 'frame',
    x: 0,
    y: 0,
    width: w,
    height: h,
    strokeColor: '#b9bcc7',
    fillColor: '#ffffff',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    locked: false,
    groupId: null,
    label,
  };
}

/**
 * An infinite page holding one selectable main frame (Fix 1.19): the
 * "page paper" is a real frame object like any other artboard.
 */
export function newFramePage(index: number, w = A4.w, h = A4.h, frameLabel?: string): Page {
  return {
    ...newPage(index),
    canvasType: 'infinite',
    width: null,
    height: null,
    elements: [mainFrame(w, h, frameLabel ?? `A4 Portrait ${index}`)],
  };
}

export function newDoc(): Doc {
  return {
    id: uid(),
    title: 'Untitled document',
    pages: [newInfinitePage(1)],
    currentPage: 0,
  };
}

export const DEFAULT_STYLE: StyleDefaults = {
  strokeColor: 'transparent',
  fillColor: '#D9D9D9',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  fontSize: 10,
  textAlign: 'left',
  stickyColor: '#fff9b1',
  textColor: '#1e1e1e',
};

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 120;

/**
 * Validate/normalize a user-entered link. Accepts http(s), mailto:, tel:;
 * bare domains get https:// prepended. Returns null when invalid.
 */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(s)) return `https://${s}`;
  return null;
}

export function docIsEmpty(doc: Doc): boolean {
  if (doc.pages.length !== 1) return false;
  const els = doc.pages[0].elements;
  return els.length === 0 || (els.length === 1 && els[0].type === 'frame');
}

/** Basic runtime validation for imported / restored documents. */
export function isValidDoc(d: unknown): d is Doc {
  if (!d || typeof d !== 'object') return false;
  const doc = d as Doc;
  if (typeof doc.id !== 'string' || !Array.isArray(doc.pages) || doc.pages.length === 0) return false;
  if (typeof doc.currentPage !== 'number') return false;
  for (const p of doc.pages) {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.elements)) return false;
    if (p.orientation !== 'portrait' && p.orientation !== 'landscape') return false;
    for (const el of p.elements) {
      if (!el || typeof el.id !== 'string' || typeof el.type !== 'string') return false;
      if (typeof el.x !== 'number' || typeof el.y !== 'number') return false;
    }
  }
  return true;
}

/** Clamp currentPage into range and fill any missing element defaults. */
export function normalizeDoc(doc: Doc): Doc {
  const pages = doc.pages.map((p, i) => ({
    ...p,
    name: p.name || `Page ${i + 1}`,
    elements: p.elements.map((el) =>
      Object.assign(
        {
          strokeColor: '#1e1e1e',
          fillColor: 'transparent',
          strokeWidth: 2,
          strokeStyle: 'solid' as StrokeStyle,
          opacity: 100,
          seed: randomSeed(),
          locked: false,
          groupId: null,
          width: 0,
          height: 0,
          cornerRadius: 0,
        },
        el
      )
    ),
  }));
  // Migration (Fix 1.19): legacy fixed pages become infinite pages whose
  // "page paper" is a real, selectable main frame at (0,0).
  const migrated = pages.map((p) => {
    if (isInfinitePage(p)) return p;
    const { w, h } = pageSize(p);
    return {
      ...p,
      canvasType: 'infinite' as const,
      width: null,
      height: null,
      elements: [mainFrame(w, h, p.name), ...p.elements],
    };
  });
  // Migration (Fix 1.39): docs that predate persistent frame membership get
  // frameId derived once from each element's center (the old implicit rule).
  const withMembership = migrated.map((p) => {
    const frames = p.elements.filter((el) => el.type === 'frame');
    return {
      ...p,
      elements: p.elements.map((el) => {
        if (el.type === 'frame') return el.frameId === undefined ? { ...el, frameId: null } : el;
        if (el.frameId !== undefined) return el;
        let cx = el.x + el.width / 2;
        let cy = el.y + el.height / 2;
        if (el.points && el.points.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [px, py] of el.points) {
            minX = Math.min(minX, px); minY = Math.min(minY, py);
            maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
          }
          cx = el.x + (minX + maxX) / 2;
          cy = el.y + (minY + maxY) / 2;
        }
        let fid: string | null = null;
        for (const f of frames) {
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) fid = f.id;
        }
        return { ...el, frameId: fid };
      }),
    };
  });
  return {
    ...doc,
    title: doc.title || 'Untitled document',
    pages: withMembership,
    currentPage: Math.min(Math.max(0, doc.currentPage), withMembership.length - 1),
  };
}
