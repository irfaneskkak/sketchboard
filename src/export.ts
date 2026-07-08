import { jsPDF } from 'jspdf';
import { absPoints, getAABB, getBounds, clampCornerRadius } from './geometry';
import {
  dashPattern,
  ensureImagesLoaded,
  getTextArea,
  isTextContainer,
  layoutText,
  LINE_HEIGHT,
  measureText,
  pageRenderBox,
  renderElement,
  renderPageToCanvas,
  textColorOf,
  wrapText,
} from './render';
import { FONT_FAMILY, isValidDoc, normalizeDoc, pageSize } from './types';
import type { Doc, Page, Point, SketchElement } from './types';

const EXPORT_SCALE = 2; // 144 DPI output

function safeName(title: string): string {
  return (title || 'sketchboard').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'sketchboard';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

/** Export every page as a single multi-page PDF, one PDF page per canvas size. */
export async function exportPDF(doc: Doc): Promise<void> {
  await ensureImagesLoaded(doc.pages);
  const boxes = doc.pages.map(pageRenderBox);
  const fmt = (b: { w: number; h: number }): [number, number] => [Math.min(b.w, b.h), Math.max(b.w, b.h)];
  const orient = (b: { w: number; h: number }) => (b.w > b.h ? ('landscape' as const) : ('portrait' as const));
  const pdf = new jsPDF({
    orientation: orient(boxes[0]),
    unit: 'pt',
    format: fmt(boxes[0]),
  });
  doc.pages.forEach((page, i) => {
    const box = boxes[i];
    if (i > 0) pdf.addPage(fmt(box), orient(box));
    const canvas = renderPageToCanvas(page, EXPORT_SCALE);
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const scale = Math.min(pw / box.w, ph / box.h);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, box.w * scale, box.h * scale);
    // Clickable hyperlink annotations over linked elements (rotated elements
    // get their axis-aligned bounding box, per the MVP spec).
    for (const el of page.elements) {
      if (!el.link) continue;
      const bb = getAABB(el);
      pdf.link((bb.x - box.x) * scale, (bb.y - box.y) * scale, bb.w * scale, bb.h * scale, { url: el.link });
    }
  });
  pdf.save(`${safeName(doc.title)}.pdf`);
}

/** Export each page as its own PNG download. */
export async function exportPNGs(doc: Doc, pageIndices?: number[]): Promise<void> {
  await ensureImagesLoaded(doc.pages);
  const indices = pageIndices ?? doc.pages.map((_, i) => i);
  const pad = String(doc.pages.length).length;
  for (const i of indices) {
    const canvas = renderPageToCanvas(doc.pages[i], EXPORT_SCALE);
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `${safeName(doc.title)}-page-${String(i + 1).padStart(pad, '0')}.png`);
    // Give the browser a beat between downloads so none get dropped.
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Export all pages stitched vertically into one tall PNG. */
export async function exportPNGBundle(doc: Doc): Promise<void> {
  await ensureImagesLoaded(doc.pages);
  const gap = 24 * EXPORT_SCALE;
  const canvases = doc.pages.map((p) => renderPageToCanvas(p, EXPORT_SCALE));
  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0) + gap * (canvases.length - 1);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) {
    ctx.drawImage(c, Math.round((width - c.width) / 2), y);
    y += c.height + gap;
  }
  const blob = await canvasToBlob(out);
  downloadBlob(blob, `${safeName(doc.title)}-all-pages.png`);
}

/* ----------------------------------- SVG ----------------------------------- */

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function strokeAttrs(el: SketchElement, roundJoin = false): string {
  const dash = dashPattern(el.strokeStyle, el.strokeWidth);
  const hidden = el.strokeColor === 'transparent' || el.strokeVisible === false;
  const op = el.strokeOpacity ?? 100;
  return [
    `stroke="${hidden ? 'none' : esc(el.strokeColor)}"`,
    `stroke-width="${el.strokeWidth}"`,
    !hidden && op < 100 ? `stroke-opacity="${op / 100}"` : '',
    dash.length ? `stroke-dasharray="${dash.join(' ')}"` : '',
    'stroke-linecap="round"',
    roundJoin ? 'stroke-linejoin="round"' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function fillAttr(el: SketchElement): string {
  const hidden = el.fillColor === 'transparent' || el.fillVisible === false;
  const op = el.fillOpacity ?? 100;
  return `fill="${hidden ? 'none' : esc(el.fillColor)}"${!hidden && op < 100 ? ` fill-opacity="${op / 100}"` : ''}`;
}

function svgTextLines(
  lines: string[],
  x: number,
  y: number,
  width: number,
  fontSize: number,
  color: string,
  align: 'left' | 'center' | 'right'
): string {
  const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
  const ax = align === 'left' ? x : align === 'center' ? x + width / 2 : x + width;
  return lines
    .map((line, i) => {
      const ty = y + i * fontSize * LINE_HEIGHT + fontSize * (LINE_HEIGHT - 1) * 0.5;
      return `<text x="${ax}" y="${ty}" font-family='${FONT_FAMILY.replace(/'/g, '')}' font-size="${fontSize}" fill="${esc(color)}" text-anchor="${anchor}" dominant-baseline="text-before-edge">${esc(line)}</text>`;
    })
    .join('');
}

/** Wrapped, vertically centered text inside a shape (matches canvas render). */
function containedTextSVG(el: SketchElement): string {
  if (!el.text || !isTextContainer(el)) return '';
  const area = getTextArea(el);
  const fontSize = el.fontSize ?? 16;
  const layout = layoutText(el.text, fontSize, area.w, area.h, 'middle');
  return svgTextLines(layout.lines, area.x, area.y + layout.offsetY, area.w, fontSize, textColorOf(el), el.textAlign ?? 'center');
}

function elementToSVG(el: SketchElement): string {
  const b = getBounds(el);
  const parts: string[] = [];
  switch (el.type) {
    case 'rectangle': {
      const cr = clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h);
      if (cr > 0) {
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${cr}" ry="${cr}" ${fillAttr(el)} ${strokeAttrs(el)} />`);
      } else {
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" ${fillAttr(el)} ${strokeAttrs(el)} />`);
      }
      parts.push(containedTextSVG(el));
      break;
    }
    case 'ellipse':
      parts.push(
        `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" ${fillAttr(el)} ${strokeAttrs(el)} />`
      );
      parts.push(containedTextSVG(el));
      break;
    case 'diamond': {
      const cr = clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h);
      if (cr > 0) {
        // Rounded diamond as a path with arc commands.
        const top: Point = [b.x + b.w / 2, b.y];
        const right: Point = [b.x + b.w, b.y + b.h / 2];
        const bottom: Point = [b.x + b.w / 2, b.y + b.h];
        const left: Point = [b.x, b.y + b.h / 2];
        const verts: Point[] = [top, right, bottom, left];
        // Build SVG path with line-to and arc commands
        let d = '';
        for (let i = 0; i < 4; i++) {
          const prev = verts[(i + 3) % 4];
          const curr = verts[i];
          const next = verts[(i + 1) % 4];
          // Offset points along edges by radius amount
          const toPrev = Math.hypot(prev[0] - curr[0], prev[1] - curr[1]);
          const toNext = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
          const r = Math.min(cr, toPrev / 2, toNext / 2);
          const ax = curr[0] + (prev[0] - curr[0]) / toPrev * r;
          const ay = curr[1] + (prev[1] - curr[1]) / toPrev * r;
          const bx = curr[0] + (next[0] - curr[0]) / toNext * r;
          const by = curr[1] + (next[1] - curr[1]) / toNext * r;
          if (i === 0) {
            d += `M ${ax} ${ay} `;
          } else {
            d += `L ${ax} ${ay} `;
          }
          d += `Q ${curr[0]} ${curr[1]} ${bx} ${by} `;
        }
        d += 'Z';
        parts.push(`<path d="${d}" ${fillAttr(el)} ${strokeAttrs(el)} />`);
      } else {
        parts.push(
          `<polygon points="${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}" ${fillAttr(el)} ${strokeAttrs(el)} />`
        );
      }
      parts.push(containedTextSVG(el));
      break;
    }
    case 'triangle': {
      const cr = Math.min(
        clampCornerRadius(el.cornerRadius ?? 0, b.w, b.h),
        Math.min(b.w, b.h) * 0.25
      );
      if (cr > 0) {
        // Rounded triangle path: shorten each edge by r and bridge corners
        // with quadratic curves through the vertex.
        const verts: Point[] = [
          [b.x + b.w / 2, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x, b.y + b.h],
        ];
        let d = '';
        for (let i = 0; i < 3; i++) {
          const prev = verts[(i + 2) % 3];
          const curr = verts[i];
          const next = verts[(i + 1) % 3];
          const lenP = Math.hypot(prev[0] - curr[0], prev[1] - curr[1]);
          const lenN = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
          const r = Math.min(cr, lenP / 2, lenN / 2);
          const entry = [curr[0] + ((prev[0] - curr[0]) / lenP) * r, curr[1] + ((prev[1] - curr[1]) / lenP) * r];
          const exit = [curr[0] + ((next[0] - curr[0]) / lenN) * r, curr[1] + ((next[1] - curr[1]) / lenN) * r];
          d += `${i === 0 ? 'M' : 'L'} ${entry[0]} ${entry[1]} Q ${curr[0]} ${curr[1]} ${exit[0]} ${exit[1]} `;
        }
        d += 'Z';
        parts.push(`<path d="${d}" ${fillAttr(el)} ${strokeAttrs(el, true)} />`);
      } else {
        parts.push(
          `<polygon points="${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}" ${fillAttr(el)} ${strokeAttrs(el)} />`
        );
      }
      parts.push(containedTextSVG(el));
      break;
    }
    case 'line':
    case 'arrow': {
      const pts = absPoints(el);
      if (pts.length < 2) break;
      if (el.controlPoint && pts.length === 2) {
        // Curved arrow/line via quadratic Bézier
        const cpAbs: Point = [el.x + el.controlPoint[0], el.y + el.controlPoint[1]];
        parts.push(
          `<path d="M ${pts[0][0]} ${pts[0][1]} Q ${cpAbs[0]} ${cpAbs[1]} ${pts[1][0]} ${pts[1][1]}" fill="none" ${strokeAttrs(el, true)} />`
        );
        if (el.type === 'arrow') {
          // Arrowhead follows Bézier tangent at t=1
          const to = pts[1];
          const dx = 2 * (to[0] - cpAbs[0]);
          const dy = 2 * (to[1] - cpAbs[1]);
          const angle = Math.atan2(dy, dx);
          const size = 8 + el.strokeWidth * 3;
          for (const spread of [-1, 1]) {
            const a = angle + Math.PI + (spread * Math.PI) / 7;
            parts.push(
              `<line x1="${to[0]}" y1="${to[1]}" x2="${to[0] + size * Math.cos(a)}" y2="${to[1] + size * Math.sin(a)}" stroke="${esc(el.strokeColor)}" stroke-width="${el.strokeWidth}" stroke-linecap="round" />`
            );
          }
          // Label at Bézier midpoint
          if (el.label) {
            const t = 0.5;
            const u = 1 - t;
            const mx = u * u * pts[0][0] + 2 * u * t * cpAbs[0] + t * t * pts[1][0];
            const my = u * u * pts[0][1] + 2 * u * t * cpAbs[1] + t * t * pts[1][1];
            const m = measureText(el.label, 14);
            parts.push(
              `<rect x="${mx - m.w / 2 - 5}" y="${my - m.h / 2 - 3}" width="${m.w + 10}" height="${m.h + 6}" rx="4" fill="rgba(255,255,255,0.92)" />`
            );
            parts.push(svgTextLines(el.label.split('\n'), mx - m.w / 2, my - m.h / 2, m.w, 14, textColorOf(el), 'center'));
          }
        }
      } else {
        parts.push(
          `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" ${strokeAttrs(el, true)} />`
        );
        if (el.type === 'arrow') {
          const from = pts[pts.length - 2];
          const to = pts[pts.length - 1];
          const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
          const size = 8 + el.strokeWidth * 3;
          for (const spread of [-1, 1]) {
            const a = angle + Math.PI + (spread * Math.PI) / 7;
            parts.push(
              `<line x1="${to[0]}" y1="${to[1]}" x2="${to[0] + size * Math.cos(a)}" y2="${to[1] + size * Math.sin(a)}" stroke="${esc(el.strokeColor)}" stroke-width="${el.strokeWidth}" stroke-linecap="round" />`
            );
          }
          if (el.label) {
            const mx = (pts[0][0] + to[0]) / 2;
            const my = (pts[0][1] + to[1]) / 2;
            const m = measureText(el.label, 14);
            parts.push(
              `<rect x="${mx - m.w / 2 - 5}" y="${my - m.h / 2 - 3}" width="${m.w + 10}" height="${m.h + 6}" rx="4" fill="rgba(255,255,255,0.92)" />`
            );
            parts.push(svgTextLines(el.label.split('\n'), mx - m.w / 2, my - m.h / 2, m.w, 14, textColorOf(el), 'center'));
          }
        }
      }
      break;
    }
    case 'freedraw': {
      const pts = absPoints(el);
      if (pts.length === 0) break;
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      if (pts.length < 3) {
        for (const p of pts) d += ` L ${p[0]} ${p[1]}`;
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
        }
        d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
      }
      parts.push(`<path d="${d}" fill="none" ${strokeAttrs(el, true)} />`);
      break;
    }
    case 'text': {
      const fontSize = el.fontSize ?? 20;
      const area = getTextArea(el);
      // Both variants wrap so exports always match canvas rendering.
      const lines = wrapText(el.text ?? '', fontSize, el.boxed ? area.w : area.w + 1);
      parts.push(svgTextLines(lines, area.x, area.y, area.w, fontSize, textColorOf(el), el.textAlign ?? 'left'));
      break;
    }
    case 'sticky': {
      const color = el.fillColor === 'transparent' ? '#fff9b1' : el.fillColor;
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="${esc(color)}" />`);
      if (el.text) {
        const fontSize = el.fontSize ?? 16;
        const area = getTextArea(el);
        const lines = wrapText(el.text, fontSize, area.w);
        parts.push(svgTextLines(lines, area.x, area.y, area.w, fontSize, textColorOf(el), el.textAlign ?? 'left'));
      }
      break;
    }
    case 'image':
      if (el.imageData) {
        parts.push(`<image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" href="${el.imageData}" />`);
      }
      break;
    case 'embed': {
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="#f8f9fa" stroke="#adb5bd" stroke-width="1.5" />`
      );
      const cx = b.x + b.w / 2;
      parts.push(svgTextLines(['Web Embed'], b.x, b.y + b.h / 2, b.w, 14, '#495057', 'center'));
      if (el.url) {
        let label = el.url;
        if (label.length > 48) label = `${label.slice(0, 45)}…`;
        parts.push(svgTextLines([label], b.x, b.y + b.h / 2 + 22, b.w, 10, '#868e96', 'center'));
      }
      void cx;
      break;
    }
    case 'frame': {
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" ${fillAttr(el)} stroke="${el.strokeColor === 'transparent' ? 'none' : esc(el.strokeColor)}" stroke-width="${Math.max(1, el.strokeWidth)}" />`
      );
      if (el.label) {
        parts.push(
          `<text x="${b.x}" y="${b.y - 7}" font-family='${FONT_FAMILY.replace(/'/g, '')}' font-size="12" fill="#868e96">${esc(el.label)}</text>`
        );
      }
      break;
    }
  }
  if (parts.length === 0) return '';
  let out = parts.join('');
  const opacity = (el.opacity ?? 100) / 100;
  if (opacity < 1) out = `<g opacity="${opacity}">${out}</g>`;
  if (el.rotation) {
    out = `<g transform="rotate(${el.rotation} ${b.x + b.w / 2} ${b.y + b.h / 2})">${out}</g>`;
  }
  if (el.link) {
    out = `<a href="${esc(el.link)}" target="_blank" rel="noopener">${out}</a>`;
  }
  return out;
}

export function pageToSVG(page: Page): string {
  const box = pageRenderBox(page);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">`,
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff" />`,
    ...page.elements.map(elementToSVG),
    '</svg>',
  ].join('\n');
}

/** Export each page as its own SVG download. */
export async function exportSVGs(doc: Doc): Promise<void> {
  const pad = String(doc.pages.length).length;
  for (let i = 0; i < doc.pages.length; i++) {
    const blob = new Blob([pageToSVG(doc.pages[i])], { type: 'image/svg+xml' });
    downloadBlob(blob, `${safeName(doc.title)}-page-${String(i + 1).padStart(pad, '0')}.svg`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const JSON_FORMAT = 'sketchboard';
const JSON_VERSION = 1;

export function exportJSON(doc: Doc): void {
  const payload = {
    format: JSON_FORMAT,
    version: JSON_VERSION,
    exportedAt: new Date().toISOString(),
    doc,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(doc.title)}.sketchboard.json`);
}

export async function importJSON(file: File): Promise<Doc> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  // Accept both the wrapped export format and a bare document.
  const candidate =
    parsed && typeof parsed === 'object' && 'doc' in (parsed as Record<string, unknown>)
      ? (parsed as { doc: unknown }).doc
      : parsed;
  if (!isValidDoc(candidate)) {
    throw new Error('That file is not a Sketchboard project.');
  }
  return normalizeDoc(candidate);
}


/* ------------------------------ frame exports ------------------------------- */

function renderFrameToCanvas(page: Page, frame: SketchElement, scale: number): HTMLCanvasElement {
  const fb = getBounds(frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(fb.w * scale));
  canvas.height = Math.max(1, Math.round(fb.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(-fb.x, -fb.y);
  ctx.fillStyle = frame.fillColor === 'transparent' ? '#ffffff' : frame.fillColor;
  ctx.fillRect(fb.x, fb.y, fb.w, fb.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(fb.x, fb.y, fb.w, fb.h);
  ctx.clip();
  for (const el of page.elements) {
    if (el.id === frame.id) continue;
    renderElement(ctx, el);
  }
  ctx.restore();
  return canvas;
}

function frameToSVG(page: Page, frame: SketchElement): string {
  const fb = getBounds(frame);
  const inner = page.elements.filter((el) => el.id !== frame.id).map(elementToSVG).join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fb.w}" height="${fb.h}" viewBox="${fb.x} ${fb.y} ${fb.w} ${fb.h}">`,
    `<defs><clipPath id="frameclip"><rect x="${fb.x}" y="${fb.y}" width="${fb.w}" height="${fb.h}" /></clipPath></defs>`,
    `<rect x="${fb.x}" y="${fb.y}" width="${fb.w}" height="${fb.h}" fill="${frame.fillColor === 'transparent' ? '#ffffff' : esc(frame.fillColor)}" />`,
    `<g clip-path="url(#frameclip)">${inner}</g>`,
    '</svg>',
  ].join('\n');
}

function frameFileName(title: string, frame: SketchElement, ext: string): string {
  const label = (frame.label || 'frame').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'frame';
  return `${safeName(title)}-${label}.${ext}`;
}

/** Export a single frame as PNG, SVG, or PDF (links preserved in PDF). */
export async function exportFrame(
  title: string,
  page: Page,
  frame: SketchElement,
  format: 'png' | 'svg' | 'pdf'
): Promise<void> {
  await ensureImagesLoaded([page]);
  const fb = getBounds(frame);
  if (format === 'png') {
    const blob = await canvasToBlob(renderFrameToCanvas(page, frame, EXPORT_SCALE));
    downloadBlob(blob, frameFileName(title, frame, 'png'));
    return;
  }
  if (format === 'svg') {
    const blob = new Blob([frameToSVG(page, frame)], { type: 'image/svg+xml' });
    downloadBlob(blob, frameFileName(title, frame, 'svg'));
    return;
  }
  const pdf = new jsPDF({
    orientation: fb.w > fb.h ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [Math.min(fb.w, fb.h), Math.max(fb.w, fb.h)],
  });
  const canvas = renderFrameToCanvas(page, frame, EXPORT_SCALE);
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const scale = Math.min(pw / fb.w, ph / fb.h);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, fb.w * scale, fb.h * scale);
  for (const el of page.elements) {
    if (!el.link || el.id === frame.id) continue;
    const bb = getAABB(el);
    if (bb.x + bb.w < fb.x || bb.x > fb.x + fb.w || bb.y + bb.h < fb.y || bb.y > fb.y + fb.h) continue;
    pdf.link((bb.x - fb.x) * scale, (bb.y - fb.y) * scale, bb.w * scale, bb.h * scale, { url: el.link });
  }
  pdf.save(frameFileName(title, frame, 'pdf'));
}

/** Frames in reading order: top to bottom, then left to right (Fix 1.22 §3). */
function framesInReadingOrder(page: Page): SketchElement[] {
  return page.elements
    .filter((el) => el.type === 'frame')
    .slice()
    .sort((a, b) => {
      const ba = getBounds(a);
      const bb = getBounds(b);
      return ba.y - bb.y || ba.x - bb.x;
    });
}

/** Build a PDF with one page per frame, each page sized to its frame. */
function buildFramesPDF(page: Page, frames: SketchElement[]): jsPDF {
  const boxes = frames.map(getBounds);
  const fmt = (b: { w: number; h: number }): [number, number] => [Math.min(b.w, b.h), Math.max(b.w, b.h)];
  const pdf = new jsPDF({
    orientation: boxes[0].w > boxes[0].h ? 'landscape' : 'portrait',
    unit: 'pt',
    format: fmt(boxes[0]),
  });
  frames.forEach((frame, i) => {
    const fb = boxes[i];
    if (i > 0) pdf.addPage(fmt(fb), fb.w > fb.h ? 'landscape' : 'portrait');
    const canvas = renderFrameToCanvas(page, frame, EXPORT_SCALE);
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const scale = Math.min(pw / fb.w, ph / fb.h);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, fb.w * scale, fb.h * scale);
    for (const el of page.elements) {
      if (!el.link || el.id === frame.id) continue;
      const bb = getAABB(el);
      if (bb.x + bb.w < fb.x || bb.x > fb.x + fb.w || bb.y + bb.h < fb.y || bb.y > fb.y + fb.h) continue;
      pdf.link((bb.x - fb.x) * scale, (bb.y - fb.y) * scale, bb.w * scale, bb.h * scale, { url: el.link });
    }
  });
  return pdf;
}

/** Export every frame on the current page as a multi-page PDF, one frame per page. */
export async function exportFramesPDF(doc: Doc): Promise<void> {
  const page = doc.pages[doc.currentPage];
  const frames = framesInReadingOrder(page);
  if (frames.length === 0) {
    throw new Error('No frames on this page. Add frames with the Frame tool (F).');
  }
  await ensureImagesLoaded([page]);
  buildFramesPDF(page, frames).save(`${safeName(doc.title)}-frames.pdf`);
}

/* ------------------------------ per-page export ------------------------------ */

function pageFileName(title: string, page: Page, ext: string): string {
  const label = (page.name || 'page').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'page';
  return `${safeName(title)}-${label}.${ext}`;
}

/** Export a single page (only that page) as PNG, SVG, or PDF (Fix 1.21). */
export async function exportPageAs(doc: Doc, pageIndex: number, format: 'png' | 'svg' | 'pdf'): Promise<void> {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error('Page not found.');
  await ensureImagesLoaded([page]);
  if (format === 'png') {
    const blob = await canvasToBlob(renderPageToCanvas(page, EXPORT_SCALE));
    downloadBlob(blob, pageFileName(doc.title, page, 'png'));
    return;
  }
  if (format === 'svg') {
    const blob = new Blob([pageToSVG(page)], { type: 'image/svg+xml' });
    downloadBlob(blob, pageFileName(doc.title, page, 'svg'));
    return;
  }
  // PDF: each frame on the page becomes its own frame-sized PDF page,
  // in reading order (Fix 1.22 §1–3). Frameless pages export their content box.
  const frames = framesInReadingOrder(page);
  if (frames.length > 0) {
    buildFramesPDF(page, frames).save(pageFileName(doc.title, page, 'pdf'));
    return;
  }
  const box = pageRenderBox(page);
  const pdf = new jsPDF({
    orientation: box.w > box.h ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [Math.min(box.w, box.h), Math.max(box.w, box.h)],
  });
  const canvas = renderPageToCanvas(page, EXPORT_SCALE);
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const scale = Math.min(pw / box.w, ph / box.h);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, box.w * scale, box.h * scale);
  for (const el of page.elements) {
    if (!el.link) continue;
    const bb = getAABB(el);
    pdf.link((bb.x - box.x) * scale, (bb.y - box.y) * scale, bb.w * scale, bb.h * scale, { url: el.link });
  }
  pdf.save(pageFileName(doc.title, page, 'pdf'));
}
