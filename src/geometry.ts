import type { Point, SketchElement } from './types';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a corner radius so it never exceeds half the smallest dimension. */
export function clampCornerRadius(radius: number, w: number, h: number): number {
  return Math.max(0, Math.min(radius, Math.min(Math.abs(w), Math.abs(h)) / 2));
}

/* ----- Quadratic Bézier helpers ----- */

/** Evaluate a quadratic Bézier at parameter t. */
function bezierAt(t: number, p0: number, cp: number, p1: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * cp + t * t * p1;
}

/** Approximate distance from point (px,py) to a quadratic Bézier curve. */
export function distToBezier(
  px: number, py: number,
  x0: number, y0: number,
  cpx: number, cpy: number,
  x1: number, y1: number,
  samples = 32
): number {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const bx = bezierAt(t, x0, cpx, x1);
    const by = bezierAt(t, y0, cpy, y1);
    min = Math.min(min, Math.hypot(px - bx, py - by));
  }
  return min;
}

/** Axis-aligned bounding box of a quadratic Bézier. */
export function bezierBounds(
  x0: number, y0: number,
  cpx: number, cpy: number,
  x1: number, y1: number
): Bounds {
  let minX = Math.min(x0, x1);
  let maxX = Math.max(x0, x1);
  let minY = Math.min(y0, y1);
  let maxY = Math.max(y0, y1);
  // Check extrema: t = (p0 - cp) / (p0 - 2*cp + p1)
  for (const [p0, cp, p1, update] of [
    [x0, cpx, x1, (v: number) => { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }],
    [y0, cpy, y1, (v: number) => { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }],
  ] as [number, number, number, (v: number) => void][]) {
    const denom = p0 - 2 * cp + p1;
    if (Math.abs(denom) > 1e-6) {
      const t = (p0 - cp) / denom;
      if (t > 0 && t < 1) update(bezierAt(t, p0, cp, p1));
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Tangent direction (dx,dy) of a quadratic Bézier at parameter t. */
export function bezierTangent(
  t: number,
  x0: number, y0: number,
  cpx: number, cpy: number,
  x1: number, y1: number
): [number, number] {
  const u = 1 - t;
  return [
    2 * u * (cpx - x0) + 2 * t * (x1 - cpx),
    2 * u * (cpy - y0) + 2 * t * (y1 - cpy),
  ];
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Bounds {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Axis-aligned bounding box of an element in page coordinates. */
export function getBounds(el: SketchElement): Bounds {
  if (el.points && el.points.length > 0) {
    // If the element has a controlPoint (curved arrow/line), include it.
    if (el.controlPoint && el.points.length === 2) {
      const [p0x, p0y] = [el.x + el.points[0][0], el.y + el.points[0][1]];
      const [p1x, p1y] = [el.x + el.points[1][0], el.y + el.points[1][1]];
      const [cpx, cpy] = [el.x + el.controlPoint[0], el.y + el.controlPoint[1]];
      return bezierBounds(p0x, p0y, cpx, cpy, p1x, p1y);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of el.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return { x: el.x + minX, y: el.y + minY, w: maxX - minX, h: maxY - minY };
  }
  return normalizeRect(el.x, el.y, el.x + el.width, el.y + el.height);
}

export function boundsUnion(list: Bounds[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsCenter(b: Bounds): Point {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

export function rotationRad(el: SketchElement): number {
  return ((el.rotation ?? 0) * Math.PI) / 180;
}

export function rotatePoint([x, y]: Point, [cx, cy]: Point, rad: number): Point {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Map a world point into the element's unrotated local space. */
export function toLocalPoint(el: SketchElement, x: number, y: number): Point {
  const rad = rotationRad(el);
  if (!rad) return [x, y];
  return rotatePoint([x, y], boundsCenter(getBounds(el)), -rad);
}

/** Axis-aligned bounding box of the element after rotation. */
export function getAABB(el: SketchElement): Bounds {
  const b = getBounds(el);
  const rad = rotationRad(el);
  if (!rad) return b;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = b.w * cos + b.h * sin;
  const h = b.w * sin + b.h * cos;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

export function pointInBounds(x: number, y: number, b: Bounds, pad = 0): boolean {
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Does point (x, y) hit a frame's visible title band above the artboard? */
export function frameTitleHitTest(el: SketchElement, x: number, y: number, threshold: number): boolean {
  if (el.type !== 'frame') return false;
  [x, y] = toLocalPoint(el, x, y);
  const b = getBounds(el);
  return (
    x >= b.x &&
    x <= b.x + Math.min(b.w, 220) &&
    y >= b.y - Math.max(22, threshold * 4) &&
    y <= b.y
  );
}

function distToPolyline(px: number, py: number, ox: number, oy: number, points: Point[]): number {
  if (points.length === 1) {
    return Math.hypot(px - (ox + points[0][0]), py - (oy + points[0][1]));
  }
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(
      px,
      py,
      ox + points[i][0],
      oy + points[i][1],
      ox + points[i + 1][0],
      oy + points[i + 1][1]
    );
    min = Math.min(min, d);
  }
  return min;
}

/** Does point (x, y) hit the element, with a tolerance in page units? */
export function hitTest(el: SketchElement, x: number, y: number, threshold: number): boolean {
  // Frame name labels sit above the frame bounds and are clickable. The
  // band scales with the hit threshold (screen-constant labels).
  if (frameTitleHitTest(el, x, y, threshold)) return true;

  // Rotated elements are tested in their unrotated local space.
  [x, y] = toLocalPoint(el, x, y);
  const b = getBounds(el);
  const tol = threshold + el.strokeWidth / 2;
  if (!pointInBounds(x, y, b, tol)) return false;

  // Shapes with contained text act solid: their interior is clickable.
  // A hidden fill (eye toggle) behaves like no fill for hit testing.
  const solid = (el.fillColor !== 'transparent' && el.fillVisible !== false) || !!el.text?.trim();

  switch (el.type) {
    case 'rectangle': {
      if (solid && pointInBounds(x, y, b)) return true;
      const near =
        distToSegment(x, y, b.x, b.y, b.x + b.w, b.y) <= tol ||
        distToSegment(x, y, b.x + b.w, b.y, b.x + b.w, b.y + b.h) <= tol ||
        distToSegment(x, y, b.x + b.w, b.y + b.h, b.x, b.y + b.h) <= tol ||
        distToSegment(x, y, b.x, b.y + b.h, b.x, b.y) <= tol;
      return near;
    }
    case 'ellipse': {
      const rx = Math.max(b.w / 2, 0.001);
      const ry = Math.max(b.h / 2, 0.001);
      const dx = (x - (b.x + rx)) / rx;
      const dy = (y - (b.y + ry)) / ry;
      const v = dx * dx + dy * dy;
      if (solid && v <= 1) return true;
      return Math.abs(Math.sqrt(v) - 1) * Math.min(rx, ry) <= tol;
    }
    case 'diamond': {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const pts: Point[] = [
        [cx, b.y],
        [b.x + b.w, cy],
        [cx, b.y + b.h],
        [b.x, cy],
      ];
      const rx = Math.max(b.w / 2, 0.001);
      const ry = Math.max(b.h / 2, 0.001);
      const inside = Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1;
      if (solid && inside) return true;
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % 4];
        if (distToSegment(x, y, x1, y1, x2, y2) <= tol) return true;
      }
      return false;
    }
    case 'triangle': {
      const apex: Point = [b.x + b.w / 2, b.y];
      const bl: Point = [b.x, b.y + b.h];
      const br: Point = [b.x + b.w, b.y + b.h];
      if (solid && pointInPolygon(x, y, [apex, br, bl])) return true;
      return (
        distToSegment(x, y, apex[0], apex[1], br[0], br[1]) <= tol ||
        distToSegment(x, y, br[0], br[1], bl[0], bl[1]) <= tol ||
        distToSegment(x, y, bl[0], bl[1], apex[0], apex[1]) <= tol
      );
    }
    case 'line':
    case 'arrow': {
      if (el.controlPoint && el.points && el.points.length === 2) {
        const pts = absPoints(el);
        const cpAbs: Point = [el.x + el.controlPoint[0], el.y + el.controlPoint[1]];
        return distToBezier(x, y, pts[0][0], pts[0][1], cpAbs[0], cpAbs[1], pts[1][0], pts[1][1]) <= tol;
      }
      return el.points ? distToPolyline(x, y, el.x, el.y, el.points) <= tol : false;
    }
    case 'freedraw':
      return el.points ? distToPolyline(x, y, el.x, el.y, el.points) <= tol : false;
    case 'text':
    case 'sticky':
    case 'image':
    case 'embed':
      return pointInBounds(x, y, b);
    case 'frame': {
      if (el.fillColor !== 'transparent' && pointInBounds(x, y, b)) return true;
      return (
        distToSegment(x, y, b.x, b.y, b.x + b.w, b.y) <= tol ||
        distToSegment(x, y, b.x + b.w, b.y, b.x + b.w, b.y + b.h) <= tol ||
        distToSegment(x, y, b.x + b.w, b.y + b.h, b.x, b.y + b.h) <= tol ||
        distToSegment(x, y, b.x, b.y + b.h, b.x, b.y) <= tol
      );
    }
    default:
      return false;
  }
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Does a lasso polygon capture an element? Center or any corner inside. */
export function lassoCaptures(poly: Point[], b: Bounds): boolean {
  const probes: Point[] = [
    [b.x + b.w / 2, b.y + b.h / 2],
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  return probes.some(([px, py]) => pointInPolygon(px, py, poly));
}

/**
 * The point on the element's boundary along the ray from its center toward
 * `toward`, pushed out by `gap`. Used for arrow binding endpoints.
 */
export function edgePoint(el: SketchElement, toward: Point, gap = 4): Point {
  const b = getBounds(el);
  const [cx, cy] = boundsCenter(b);
  let dx = toward[0] - cx;
  let dy = toward[1] - cy;
  if (dx === 0 && dy === 0) dx = 1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const rx = Math.max(b.w / 2, 0.001);
  const ry = Math.max(b.h / 2, 0.001);

  let t: number;
  switch (el.type) {
    case 'ellipse':
      t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
      break;
    case 'diamond':
      t = 1 / (Math.abs(ux) / rx + Math.abs(uy) / ry);
      break;
    default: {
      // rectangle-like boundary
      const tx = ux === 0 ? Infinity : rx / Math.abs(ux);
      const ty = uy === 0 ? Infinity : ry / Math.abs(uy);
      t = Math.min(tx, ty);
    }
  }
  t = Math.min(t, len); // never overshoot past the target point
  return [cx + ux * (t + gap), cy + uy * (t + gap)];
}

const BINDABLE = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'sticky', 'image', 'text', 'embed', 'frame']);

export function isBindable(el: SketchElement): boolean {
  return BINDABLE.has(el.type);
}

/** Topmost bindable element near (x, y). */
export function findBindTarget(
  elements: SketchElement[],
  x: number,
  y: number,
  threshold: number,
  excludeId?: string
): SketchElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isBindable(el) || el.id === excludeId || el.locked) continue;
    const [lx, ly] = toLocalPoint(el, x, y);
    const b = getBounds(el);
    if (el.type === 'frame') {
      // A frame's interior is a canvas: arrows drawn inside it must not bind
      // to the frame itself. Bind only near the frame's border.
      const nearEdge =
        Math.abs(lx - b.x) <= threshold ||
        Math.abs(lx - (b.x + b.w)) <= threshold ||
        Math.abs(ly - b.y) <= threshold ||
        Math.abs(ly - (b.y + b.h)) <= threshold;
      if (nearEdge && pointInBounds(lx, ly, b, threshold)) return el;
      continue;
    }
    if (pointInBounds(lx, ly, b, threshold)) return el;
  }
  return null;
}

/** Absolute endpoints of a two-point linear element. */
export function absPoints(el: SketchElement): Point[] {
  return (el.points ?? [[0, 0]]).map(([px, py]) => [el.x + px, el.y + py] as Point);
}

/**
 * Recompute endpoints of bound arrows after shapes move/resize.
 * Mutates nothing; returns a new elements array where affected arrows are updated.
 */
export function updateBoundArrows(elements: SketchElement[]): SketchElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.map((el) => {
    if (el.type !== 'arrow' || !el.points || el.points.length < 2) return el;
    const start = el.startBinding ? byId.get(el.startBinding) : null;
    const end = el.endBinding ? byId.get(el.endBinding) : null;
    if (!start && !end) return el;

    const pts = absPoints(el);
    let a = pts[0];
    let bPt = pts[pts.length - 1];
    const aAnchor: Point = start ? boundsCenter(getBounds(start)) : a;
    const bAnchor: Point = end ? boundsCenter(getBounds(end)) : bPt;
    if (start) a = edgePoint(start, bAnchor);
    if (end) bPt = edgePoint(end, aAnchor);

    return {
      ...el,
      x: a[0],
      y: a[1],
      points: [
        [0, 0],
        [bPt[0] - a[0], bPt[1] - a[1]],
      ] as Point[],
      startBinding: start ? el.startBinding : null,
      endBinding: end ? el.endBinding : null,
    };
  });
}
