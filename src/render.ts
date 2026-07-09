import { getAABB, getBounds, absPoints, clampCornerRadius, bezierTangent, rotationRad } from './geometry';
import { FONT_FAMILY, pageSize } from './types';
import type { Page, Point, SketchElement, StrokeStyle } from './types';

export const LINE_HEIGHT = 1.3;

/* ---------------------------------- images --------------------------------- */

const imageCache = new Map<string, HTMLImageElement>();
const imageLoading = new Set<string>();

/** Get a decoded image for a data URL; triggers onLoad once ready. */
export function getImage(dataURL: string, onLoad?: () => void): HTMLImageElement | null {
  const cached = imageCache.get(dataURL);
  if (cached) return cached;
  if (!imageLoading.has(dataURL)) {
    imageLoading.add(dataURL);
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataURL, img);
      imageLoading.delete(dataURL);
      onLoad?.();
    };
    img.onerror = () => imageLoading.delete(dataURL);
    img.src = dataURL;
  }
  return null;
}

/** Resolve when every image element on the given pages is decoded. */
export async function ensureImagesLoaded(pages: Page[]): Promise<void> {
  const urls = new Set<string>();
  for (const p of pages) {
    for (const el of p.elements) {
      if (el.type === 'image' && el.imageData) urls.add(el.imageData);
    }
  }
  await Promise.all(
    [...urls].map(
      (url) =>
        new Promise<void>((resolve) => {
          if (imageCache.has(url)) return resolve();
          const img = new Image();
          img.onload = () => {
            imageCache.set(url, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        })
    )
  );
}

/* ----------------------------------- text ---------------------------------- */

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  return measureCtx;
}

export function measureText(text: string, fontSize: number): { w: number; h: number } {
  const ctx = getMeasureCtx();
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const lines = text.split('\n');
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line || ' ').width);
  return { w: Math.max(w, fontSize * 0.6), h: lines.length * fontSize * LINE_HEIGHT };
}

/** Height of a wrapped block of text at the given width. */
export function textBlockHeight(text: string, fontSize: number, maxWidth: number): number {
  return wrapText(text, fontSize, maxWidth).length * fontSize * LINE_HEIGHT;
}

/**
 * Internal padding for contained text: 8px on compact shapes, 12px default,
 * 16px on large cards (Fix 1.2 §14, Fix 1.3).
 */
export function shapePadding(w: number, h: number): number {
  const m = Math.min(w, h);
  if (m < 100) return 8;
  if (m < 260) return 12;
  return 16;
}

/** Internal padding of standalone text boxes (Fix 1.7). */
export const TEXT_BOX_PADDING = 8;

/**
 * Exact content-hugging height for a fixed-width text box: wrapped lines ×
 * line height + vertical padding (Fix 1.8 — shrinks as well as grows).
 */
export function hugBoxedTextHeight(el: SketchElement, text?: string): number {
  const fontSize = el.fontSize ?? 20;
  const inner = Math.max(8, el.width - 2 * TEXT_BOX_PADDING);
  const content = Math.max(textBlockHeight(text ?? el.text ?? '', fontSize, inner), fontSize * LINE_HEIGHT);
  return content + 2 * TEXT_BOX_PADDING;
}

export interface TextArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The padded region inside an element where contained text may be laid out. */
export function getTextArea(el: SketchElement): TextArea {
  const b = getBounds(el);
  const p = shapePadding(b.w, b.h);
  switch (el.type) {
    case 'ellipse': {
      // Largest axis-aligned rectangle inscribed in an ellipse is w/√2 × h/√2.
      const iw = Math.max(8, b.w * 0.7071 - 2 * p);
      const ih = Math.max(8, b.h * 0.7071 - 2 * p);
      return { x: b.x + (b.w - iw) / 2, y: b.y + (b.h - ih) / 2, w: iw, h: ih };
    }
    case 'diamond': {
      // Inscribed rectangle of a diamond is w/2 × h/2; it already clears the
      // corners, so apply only a light extra padding.
      const iw = Math.max(8, b.w / 2 - p);
      const ih = Math.max(8, b.h / 2 - p);
      return { x: b.x + (b.w - iw) / 2, y: b.y + (b.h - ih) / 2, w: iw, h: ih };
    }
    case 'triangle': {
      const iw = Math.max(8, b.w * 0.5 - p);
      const ih = Math.max(8, b.h * 0.45 - p);
      return { x: b.x + (b.w - iw) / 2, y: b.y + b.h * 0.5 - p / 2, w: iw, h: ih };
    }
    case 'sticky':
      return { x: b.x + p, y: b.y + p, w: Math.max(8, b.w - 2 * p), h: Math.max(8, b.h - 2 * p) };
    case 'text': {
      if (!el.boxed) return { x: b.x, y: b.y, w: Math.max(8, b.w), h: Math.max(8, b.h) };
      const bp = TEXT_BOX_PADDING;
      return { x: b.x + bp, y: b.y + bp, w: Math.max(8, b.w - 2 * bp), h: Math.max(8, b.h - 2 * bp) };
    }
    default:
      return { x: b.x + p, y: b.y + p, w: Math.max(8, b.w - 2 * p), h: Math.max(8, b.h - 2 * p) };
  }
}

const TEXT_CONTAINERS = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);

export function isTextContainer(el: SketchElement): boolean {
  return TEXT_CONTAINERS.has(el.type);
}

/**
 * If an element's contained text no longer fits its height, grow the element
 * symmetrically so the text does (Fix 1.2 §13 auto-height).
 */
export function ensureTextFits(el: SketchElement): SketchElement {
  const fontSize = el.fontSize ?? 16;
  if (el.type === 'text' && el.boxed && el.text) {
    const area = getTextArea(el);
    const padding = el.height - area.h; // vertical padding overhead
    const needed = textBlockHeight(el.text, fontSize, area.w) + Math.max(0, padding);
    return needed > el.height ? { ...el, height: needed } : el;
  }
  if (!isTextContainer(el) || !el.text?.trim()) return el;
  const area = getTextArea(el);
  const needed = textBlockHeight(el.text, fontSize, area.w);
  if (needed <= area.h) return el;
  // Convert the missing text-area height back into shape height.
  const ratio = el.type === 'ellipse' ? 1 / 0.7071 : el.type === 'diamond' || el.type === 'triangle' ? 2 : 1;
  const grow = (needed - area.h) * ratio;
  return { ...el, y: el.y - grow / 2, height: el.height + grow };
}

/** Draw wrapped text centered inside a shape, clipped to its bounds. */
function renderContainedText(ctx: CanvasRenderingContext2D, el: SketchElement) {
  if (!el.text) return;
  const b = getBounds(el);
  const area = getTextArea(el);
  const fontSize = el.fontSize ?? 16;
  const layout = layoutText(el.text, fontSize, area.w, area.h, 'middle');
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
  drawTextLines(ctx, layout.lines, area.x, area.y + layout.offsetY, area.w, fontSize, textColorOf(el), el.textAlign ?? 'center');
  ctx.restore();
}

/** Split a word that is wider than maxWidth into character-level chunks. */
function breakWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur === '' || ctx.measureText(cur + ch).width <= maxWidth) {
      cur += ch;
    } else {
      parts.push(cur);
      cur = ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const ctx = getMeasureCtx();
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of rawLine.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        out.push(line);
        line = '';
      }
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        // A single word wider than the container: break it safely.
        const parts = breakWord(ctx, word, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) out.push(parts[i]);
        line = parts[parts.length - 1] ?? '';
      }
    }
    out.push(line);
  }
  return out;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  contentHeight: number;
  /** Offset of the first line's top within the container area (vertical alignment applied). */
  offsetY: number;
}

/**
 * Common text layout used by canvas rendering, the editor overlay, and SVG
 * export: wraps to the area width and applies vertical alignment.
 */
export function layoutText(
  text: string,
  fontSize: number,
  areaW: number,
  areaH: number,
  valign: 'top' | 'middle' = 'middle'
): TextLayout {
  const lines = wrapText(text, fontSize, areaW);
  const lineHeight = fontSize * LINE_HEIGHT;
  const contentHeight = lines.length * lineHeight;
  const offsetY = valign === 'middle' ? Math.max(0, (areaH - contentHeight) / 2) : 0;
  return { lines, lineHeight, contentHeight, offsetY };
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  width: number,
  fontSize: number,
  color: string,
  align: 'left' | 'center' | 'right'
) {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  const anchorX = align === 'left' ? x : align === 'center' ? x + width / 2 : x + width;
  lines.forEach((line, i) => {
    ctx.fillText(line, anchorX, y + i * fontSize * LINE_HEIGHT + fontSize * (LINE_HEIGHT - 1) * 0.5);
  });
  ctx.textAlign = 'left';
}

/* --------------------------------- elements -------------------------------- */

export function dashPattern(style: StrokeStyle, strokeWidth: number): number[] {
  if (style === 'dashed') return [Math.max(6, strokeWidth * 3), Math.max(4, strokeWidth * 2)];
  if (style === 'dotted') return [0.1, Math.max(4, strokeWidth * 2.2)];
  return [];
}

function applyStroke(ctx: CanvasRenderingContext2D, el: SketchElement, joinRound = false) {
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.setLineDash(dashPattern(el.strokeStyle, el.strokeWidth));
  ctx.lineCap = el.strokeStyle === 'dotted' ? 'round' : 'round';
  ctx.lineJoin = joinRound ? 'round' : 'miter';
}

function fillAndStroke(ctx: CanvasRenderingContext2D, el: SketchElement) {
  const base = ctx.globalAlpha;
  if (el.fillColor !== 'transparent' && el.fillVisible !== false) {
    ctx.globalAlpha = base * ((el.fillOpacity ?? 100) / 100);
    ctx.fillStyle = el.fillColor;
    ctx.fill();
  }
  if (el.strokeWidth > 0 && el.strokeColor !== 'transparent' && el.strokeVisible !== false) {
    ctx.globalAlpha = base * ((el.strokeOpacity ?? 100) / 100);
    ctx.stroke();
  }
  ctx.globalAlpha = base;
}

/** Independent text color, falling back to strokeColor for older documents. */
export function textColorOf(el: SketchElement): string {
  if (el.textColor) return el.textColor;
  return el.strokeColor === 'transparent' ? '#1e1e1e' : el.strokeColor;
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  el: SketchElement,
  tangentDir?: [number, number]
) {
  let angle: number;
  if (tangentDir && (tangentDir[0] !== 0 || tangentDir[1] !== 0)) {
    angle = Math.atan2(tangentDir[1], tangentDir[0]);
  } else {
    angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  }
  const size = 8 + el.strokeWidth * 3;
  ctx.save();
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const spread of [-1, 1]) {
    const a = angle + Math.PI + (spread * Math.PI) / 7;
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] + size * Math.cos(a), to[1] + size * Math.sin(a));
  }
  ctx.stroke();
  ctx.restore();
}

function drawFreedraw(ctx: CanvasRenderingContext2D, el: SketchElement) {
  const pts = absPoints(el);
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern(el.strokeStyle, el.strokeWidth));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length < 3) {
    for (const p of pts) ctx.lineTo(p[0], p[1]);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSticky(ctx: CanvasRenderingContext2D, el: SketchElement) {
  const b = getBounds(el);
  const color = el.fillColor === 'transparent' ? '#fff9b1' : el.fillColor;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 2);
  ctx.fill();
  ctx.restore();

  if (el.text) {
    const fontSize = el.fontSize ?? 16;
    const area = getTextArea(el);
    const layout = layoutText(el.text, fontSize, area.w, area.h, 'top');
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    drawTextLines(ctx, layout.lines, area.x, area.y, area.w, fontSize, textColorOf(el), el.textAlign ?? 'left');
    ctx.restore();
  }
}

function drawImageEl(ctx: CanvasRenderingContext2D, el: SketchElement, onImageLoad?: () => void) {
  const b = getBounds(el);
  const img = el.imageData ? getImage(el.imageData, onImageLoad) : null;
  if (img) {
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
  } else {
    ctx.save();
    ctx.fillStyle = '#e9ecef';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#adb5bd';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

function drawArrowLabel(ctx: CanvasRenderingContext2D, el: SketchElement) {
  if (!el.label || !el.points || el.points.length < 2) return;
  const pts = absPoints(el);
  let mx: number, my: number;
  if (el.controlPoint) {
    // Midpoint on the Bézier at t=0.5
    const cp: Point = [el.x + el.controlPoint[0], el.y + el.controlPoint[1]];
    const t = 0.5;
    const u = 1 - t;
    mx = u * u * pts[0][0] + 2 * u * t * cp[0] + t * t * pts[1][0];
    my = u * u * pts[0][1] + 2 * u * t * cp[1] + t * t * pts[1][1];
  } else {
    const a = pts[0];
    const b = pts[pts.length - 1];
    mx = (a[0] + b[0]) / 2;
    my = (a[1] + b[1]) / 2;
  }
  const fontSize = 14;
  const { w, h } = measureText(el.label, fontSize);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.roundRect(mx - w / 2 - 5, my - h / 2 - 3, w + 10, h + 6, 4);
  ctx.fill();
  drawTextLines(ctx, el.label.split('\n'), mx - w / 2, my - h / 2, w, fontSize, textColorOf(el), 'center');
  ctx.restore();
}

/** Placeholder card for a web embed (no live iframe in the MVP). */
function drawEmbed(ctx: CanvasRenderingContext2D, el: SketchElement) {
  const b = getBounds(el);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 8);
  ctx.fillStyle = '#f8f9fa';
  ctx.fill();
  ctx.strokeStyle = '#adb5bd';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  // globe glyph
  const r = Math.max(10, Math.min(24, Math.min(b.w, b.h) * 0.12));
  ctx.strokeStyle = '#868e96';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.9, r, 0, Math.PI * 2);
  ctx.moveTo(cx - r, cy - r * 0.9);
  ctx.lineTo(cx + r, cy - r * 0.9);
  ctx.ellipse(cx, cy - r * 0.9, r * 0.45, r, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#495057';
  ctx.font = `600 ${Math.max(11, Math.min(16, b.w * 0.05))}px ${FONT_FAMILY}`;
  ctx.fillText('Web Embed', cx, cy + r * 0.4);
  if (el.url) {
    const urlFont = Math.max(9, Math.min(12, b.w * 0.035));
    ctx.font = `${urlFont}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#868e96';
    let label = el.url;
    while (label.length > 4 && ctx.measureText(label).width > b.w - 24) {
      label = label.slice(0, -4) + '…';
    }
    ctx.fillText(label, cx, cy + r * 0.4 + urlFont * 1.8);
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

export function renderElement(
  ctx: CanvasRenderingContext2D,
  el: SketchElement,
  onImageLoad?: () => void,
  /** Frame label font size in page units (pass 12/zoom for screen-constant labels). */
  frameLabelSize?: number
) {
  ctx.save();
  ctx.globalAlpha = (el.opacity ?? 100) / 100;
  const b = getBounds(el);

  if (el.rotation) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  switch (el.type) {
    case 'rectangle': {
      const cr = clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h);
      ctx.beginPath();
      if (cr > 0) {
        ctx.roundRect(b.x, b.y, b.w, b.h, cr);
      } else {
        ctx.rect(b.x, b.y, b.w, b.h);
      }
      applyStroke(ctx, el);
      fillAndStroke(ctx, el);
      renderContainedText(ctx, el);
      break;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 0.1), Math.max(b.h / 2, 0.1), 0, 0, Math.PI * 2);
      applyStroke(ctx, el);
      fillAndStroke(ctx, el);
      renderContainedText(ctx, el);
      break;
    case 'diamond': {
      const cr = clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h);
      ctx.beginPath();
      if (cr > 0) {
        // Rounded diamond using arcTo at each vertex.
        const top: Point = [b.x + b.w / 2, b.y];
        const right: Point = [b.x + b.w, b.y + b.h / 2];
        const bottom: Point = [b.x + b.w / 2, b.y + b.h];
        const left: Point = [b.x, b.y + b.h / 2];
        const verts: Point[] = [top, right, bottom, left];
        // Start at midpoint between last vertex (left) and first vertex (top)
        const startX = (verts[3][0] + verts[0][0]) / 2;
        const startY = (verts[3][1] + verts[0][1]) / 2;
        ctx.moveTo(startX, startY);
        for (let i = 0; i < 4; i++) {
          const curr = verts[i];
          const next = verts[(i + 1) % 4];
          ctx.arcTo(curr[0], curr[1], next[0], next[1], cr);
        }
        ctx.closePath();
      } else {
        ctx.moveTo(b.x + b.w / 2, b.y);
        ctx.lineTo(b.x + b.w, b.y + b.h / 2);
        ctx.lineTo(b.x + b.w / 2, b.y + b.h);
        ctx.lineTo(b.x, b.y + b.h / 2);
        ctx.closePath();
      }
      applyStroke(ctx, el);
      fillAndStroke(ctx, el);
      renderContainedText(ctx, el);
      break;
    }
    case 'triangle': {
      const cr = Math.min(
        clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h),
        Math.min(b.w, b.h) * 0.25
      );
      const verts: Point[] = [
        [b.x + b.w / 2, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h],
      ];
      ctx.beginPath();
      if (cr > 0) {
        // Rounded triangle: arcTo at each vertex, all corners even.
        const mid: Point = [(verts[2][0] + verts[0][0]) / 2, (verts[2][1] + verts[0][1]) / 2];
        ctx.moveTo(mid[0], mid[1]);
        for (let i = 0; i < 3; i++) {
          const v = verts[i];
          const n = verts[(i + 1) % 3];
          ctx.arcTo(v[0], v[1], n[0], n[1], cr);
        }
        ctx.closePath();
      } else {
        ctx.moveTo(verts[0][0], verts[0][1]);
        ctx.lineTo(verts[1][0], verts[1][1]);
        ctx.lineTo(verts[2][0], verts[2][1]);
        ctx.closePath();
      }
      applyStroke(ctx, el);
      fillAndStroke(ctx, el);
      renderContainedText(ctx, el);
      break;
    }
    case 'line':
    case 'arrow': {
      const pts = absPoints(el);
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        if (el.controlPoint && pts.length === 2) {
          // Curved arrow/line via quadratic Bézier
          const cpAbs: Point = [el.x + el.controlPoint[0], el.y + el.controlPoint[1]];
          ctx.quadraticCurveTo(cpAbs[0], cpAbs[1], pts[1][0], pts[1][1]);
          applyStroke(ctx, el, true);
          ctx.stroke();
          if (el.type === 'arrow') {
            // Arrowhead follows the Bézier tangent at t=1
            const tangent = bezierTangent(1, pts[0][0], pts[0][1], cpAbs[0], cpAbs[1], pts[1][0], pts[1][1]);
            drawArrowhead(ctx, pts[0], pts[1], el, tangent);
            drawArrowLabel(ctx, el);
          }
        } else {
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          applyStroke(ctx, el, true);
          ctx.stroke();
          if (el.type === 'arrow') {
            drawArrowhead(ctx, pts[pts.length - 2], pts[pts.length - 1], el);
            drawArrowLabel(ctx, el);
          }
        }
      }
      break;
    }
    case 'freedraw':
      drawFreedraw(ctx, el);
      break;
    case 'text': {
      const fontSize = el.fontSize ?? 20;
      if (el.boxed) {
        // Fixed-width text box: wrap within the padded area, clip to bounds.
        const area = getTextArea(el);
        const layout = layoutText(el.text ?? '', fontSize, area.w, area.h, 'top');
        ctx.save();
        ctx.beginPath();
        ctx.rect(b.x, b.y, b.w, b.h);
        ctx.clip();
        drawTextLines(ctx, layout.lines, area.x, area.y, area.w, fontSize, textColorOf(el), el.textAlign ?? 'left');
        ctx.restore();
      } else {
        // Auto-width text: width tracks the content, but wrap at the box
        // width anyway (with a rounding epsilon) so text can never escape
        // its bounding box (Fix 1.7).
        const layout = layoutText(el.text ?? '', fontSize, b.w + 1, b.h, 'top');
        drawTextLines(ctx, layout.lines, b.x, b.y, b.w, fontSize, textColorOf(el), el.textAlign ?? 'left');
      }
      break;
    }
    case 'sticky':
      drawSticky(ctx, el);
      break;
    case 'image':
      drawImageEl(ctx, el, onImageLoad);
      break;
    case 'embed':
      drawEmbed(ctx, el);
      break;
    case 'frame': {
      // Artboard: solid background, hairline border, name label above.
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      if (el.fillColor !== 'transparent') {
        ctx.fillStyle = el.fillColor;
        ctx.fill();
      }
      if (el.strokeColor !== 'transparent') {
        ctx.strokeStyle = el.strokeColor;
        ctx.lineWidth = Math.max(1, el.strokeWidth);
        ctx.setLineDash(dashPattern(el.strokeStyle, el.strokeWidth));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (el.label) {
        const size = frameLabelSize ?? 12;
        ctx.font = `500 ${size}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#868e96';
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(el.label, b.x, b.y - size * 0.58);
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * Render a page's full contents (white paper + elements, clipped to the page)
 * into a canvas context. Assumes ctx is already transformed so that page
 * coordinate (0,0) maps to the paper's top-left corner at scale 1.
 */
/* ----------------------------- frame clipping ------------------------------ */

/**
 * The frame that clips this element: its stored frameId (Fix 1.39 —
 * membership follows the pointer while dragging, not geometric overlap).
 */
export function clipFrameFor(el: SketchElement, elements: SketchElement[]): SketchElement | null {
  if (el.type === 'frame' || !el.frameId) return null;
  return elements.find((f) => f.id === el.frameId && f.type === 'frame') ?? null;
}

/** Trace a frame's (possibly rotated) rectangle into the current path. */
function frameClipPath(ctx: CanvasRenderingContext2D, frame: SketchElement) {
  const fb = getBounds(frame);
  const rad = rotationRad(frame);
  ctx.beginPath();
  if (rad) {
    const cx = fb.x + fb.w / 2;
    const cy = fb.y + fb.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.translate(-cx, -cy);
    ctx.rect(fb.x, fb.y, fb.w, fb.h);
    ctx.restore();
  } else {
    ctx.rect(fb.x, fb.y, fb.w, fb.h);
  }
}

/**
 * Render an element, clipped to its containing frame when it has one.
 * Elements outside every frame render unclipped (Fix 1.37).
 */
export function renderElementClipped(
  ctx: CanvasRenderingContext2D,
  el: SketchElement,
  elements: SketchElement[],
  onImageLoad?: () => void,
  frameLabelSize?: number
) {
  const frame = clipFrameFor(el, elements);
  if (!frame) {
    renderElement(ctx, el, onImageLoad, frameLabelSize);
    return;
  }
  ctx.save();
  frameClipPath(ctx, frame);
  ctx.clip();
  renderElement(ctx, el, onImageLoad, frameLabelSize);
  ctx.restore();
}

export function renderPageContents(
  ctx: CanvasRenderingContext2D,
  page: Page,
  onImageLoad?: () => void
) {
  const { w, h } = pageSize(page);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  for (const el of page.elements) {
    renderElementClipped(ctx, el, page.elements, onImageLoad);
  }
  ctx.restore();
}

/**
 * The rectangle a page occupies for export/thumbnail purposes: fixed pages
 * are their exact size at (0,0); infinite pages use the padded bounding box
 * of their content (a blank 1024×768 view when empty).
 */
export function pageRenderBox(page: Page): { x: number; y: number; w: number; h: number } {
  if (page.canvasType !== 'infinite') {
    const { w, h } = pageSize(page);
    return { x: 0, y: 0, w, h };
  }
  if (page.elements.length === 0) return { x: 0, y: 0, w: 1024, h: 768 };
  // Pages whose content is organized in frames export exactly the frame area.
  const frames = page.elements.filter((el) => el.type === 'frame');
  if (frames.length > 0) {
    const fb = frames.map(getBounds);
    const minX = Math.min(...fb.map((b) => b.x));
    const minY = Math.min(...fb.map((b) => b.y));
    const maxX = Math.max(...fb.map((b) => b.x + b.w));
    const maxY = Math.max(...fb.map((b) => b.y + b.h));
    return { x: minX, y: minY, w: Math.max(200, maxX - minX), h: Math.max(200, maxY - minY) };
  }
  const boxes = page.elements.map(getAABB);
  const pad = 60;
  const minX = Math.min(...boxes.map((b) => b.x)) - pad;
  const minY = Math.min(...boxes.map((b) => b.y)) - pad;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
  return { x: minX, y: minY, w: Math.max(200, maxX - minX), h: Math.max(200, maxY - minY) };
}

/** Render a page to a standalone canvas at the given scale (for export/thumbnails). */
export function renderPageToCanvas(page: Page, scale: number): HTMLCanvasElement {
  const box = pageRenderBox(page);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (page.canvasType !== 'infinite') {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }
  for (const el of page.elements) {
    renderElementClipped(ctx, el, page.elements);
  }
  ctx.restore();
  return canvas;
}
