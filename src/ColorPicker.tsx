import { useEffect, useRef, useState } from 'react';

/* ------------------------------ color helpers ------------------------------ */

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/**
 * Black or white — whichever has the higher WCAG contrast ratio against the
 * given fill. Transparent fills sit on the white page, so they read as light.
 */
export function contrastTextColor(fill: string): string {
  if (fill === 'transparent') return '#1e1e1e';
  const rgb = hexToRgb(fill);
  if (!rgb) return '#1e1e1e';
  const [lr, lg, lb] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const contrastWithWhite = 1.05 / (L + 0.05);
  const contrastWithBlack = (L + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#1e1e1e';
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/* ------------------------------ recent colors ------------------------------ */

const RECENTS_KEY = 'sketchboard-recent-colors';

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((c) => typeof c === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(color: string) {
  if (color === 'transparent') return;
  const list = [color, ...loadRecents().filter((c) => c !== color)].slice(0, 8);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/* --------------------------------- component -------------------------------- */

const PRESETS = [
  '#1e1e1e', '#495057', '#adb5bd', '#ffffff',
  '#e03131', '#f08c00', '#ffd43b', '#2f9e44',
  '#1971c2', '#4dabf7', '#9c36b5', '#e64980',
];

const SV_W = 176;
const SV_H = 128;

interface PickerProps {
  value: string;
  allowTransparent?: boolean;
  /** Tooltip for the transparent option, e.g. "No fill" or "No stroke". */
  transparentLabel?: string;
  onLive: (color: string) => void;
  onCommit: (color: string) => void;
  onClose: () => void;
  /** Fixed-position coordinates so the popover escapes scrollable panels. */
  position?: { top: number; right: number };
}

export function ColorPickerPopover({
  value,
  allowTransparent,
  transparentLabel = 'No fill',
  onLive,
  onCommit,
  onClose,
  position,
}: PickerProps) {
  const initial = hexToRgb(value) ?? [30, 30, 30];
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...initial));
  const [hexField, setHexField] = useState(value === 'transparent' ? '' : rgbToHex(...initial));
  const [recents] = useState(loadRecents);
  const svRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentHex = rgbToHex(...hsvToRgb(...hsv));

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // Paint the saturation/value square for the current hue.
  useEffect(() => {
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
    const horiz = ctx.createLinearGradient(0, 0, SV_W, 0);
    horiz.addColorStop(0, '#ffffff');
    horiz.addColorStop(1, rgbToHex(hr, hg, hb));
    ctx.fillStyle = horiz;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const vert = ctx.createLinearGradient(0, 0, 0, SV_H);
    vert.addColorStop(0, 'rgba(0,0,0,0)');
    vert.addColorStop(1, '#000000');
    ctx.fillStyle = vert;
    ctx.fillRect(0, 0, SV_W, SV_H);
  }, [hsv[0]]);

  const applyHsv = (next: [number, number, number], commit: boolean) => {
    setHsv(next);
    const hex = rgbToHex(...hsvToRgb(...next));
    setHexField(hex);
    if (commit) {
      pushRecent(hex);
      onCommit(hex);
    } else {
      onLive(hex);
    }
  };

  const svFromEvent = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = svRef.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return [s, v];
  };

  const commitDiscrete = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (rgb) {
      setHsv(rgbToHsv(...rgb));
      setHexField(rgbToHex(...rgb));
    }
    pushRecent(hex);
    onCommit(hex);
  };

  const markerX = hsv[1] * SV_W;
  const markerY = (1 - hsv[2]) * SV_H;

  return (
    <div className="color-popover" ref={rootRef} style={position}>
      <div className="sv-wrap">
        <canvas
          ref={svRef}
          width={SV_W}
          height={SV_H}
          onPointerDown={(e) => {
            draggingRef.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const [s, v] = svFromEvent(e);
            applyHsv([hsv[0], s, v], false);
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            const [s, v] = svFromEvent(e);
            applyHsv([hsv[0], s, v], false);
          }}
          onPointerUp={(e) => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            const [s, v] = svFromEvent(e);
            applyHsv([hsv[0], s, v], true);
          }}
        />
        <div className="sv-marker" style={{ left: markerX - 6, top: markerY - 6, background: currentHex }} />
      </div>

      <input
        className="hue-slider"
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv[0])}
        onChange={(e) => applyHsv([Number(e.target.value), hsv[1], hsv[2]], false)}
        onPointerUp={() => applyHsv(hsv, true)}
        onKeyUp={() => applyHsv(hsv, true)}
        aria-label="Hue"
      />

      <div className="hex-row">
        <span className="hex-chip" style={{ background: value === 'transparent' ? undefined : currentHex }} />
        <input
          className="hex-input"
          value={hexField}
          placeholder="#RRGGBB"
          spellCheck={false}
          onChange={(e) => setHexField(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const rgb = hexToRgb(hexField);
              if (rgb) commitDiscrete(rgbToHex(...rgb));
            }
          }}
          onBlur={() => {
            const rgb = hexToRgb(hexField);
            if (rgb && rgbToHex(...rgb) !== value) commitDiscrete(rgbToHex(...rgb));
          }}
          aria-label="Hex color code"
        />
        {allowTransparent && (
          <button
            className={`swatch transparent ${value === 'transparent' ? 'active' : ''}`}
            title={transparentLabel}
            aria-label={transparentLabel}
            onClick={() => onCommit('transparent')}
          />
        )}
      </div>

      <div className="picker-section-label">Presets</div>
      <div className="swatch-row">
        {PRESETS.map((c) => (
          <button
            key={c}
            className={`swatch small ${value === c ? 'active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => commitDiscrete(c)}
          />
        ))}
      </div>

      {recents.length > 0 && (
        <>
          <div className="picker-section-label">Recent</div>
          <div className="swatch-row">
            {recents.map((c) => (
              <button
                key={c}
                className={`swatch small ${value === c ? 'active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => commitDiscrete(c)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ButtonProps {
  value: string;
  allowTransparent?: boolean;
  transparentLabel?: string;
  label: string;
  /** 'ring' = rainbow "More colors" trigger; 'swatch' = current-color chip. */
  variant?: 'ring' | 'swatch';
  onLive: (color: string) => void;
  onCommit: (color: string) => void;
}

export function ColorPickerButton({
  value,
  allowTransparent,
  transparentLabel,
  label,
  variant = 'ring',
  onLive,
  onCommit,
}: ButtonProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({
      top: Math.min(r.bottom + 8, window.innerHeight - 380),
      right: Math.max(8, window.innerWidth - r.right - 4),
    });
  };

  return (
    <div className="color-picker-anchor">
      {variant === 'swatch' ? (
        <button
          ref={btnRef}
          className={`swatch paint-swatch ${value === 'transparent' ? 'transparent' : ''}`}
          style={value === 'transparent' ? {} : { background: value }}
          title={`${label}: ${value} — open color picker`}
          aria-label={`${label} color picker`}
          onClick={toggle}
        />
      ) : (
        <button
          ref={btnRef}
          className="picker-trigger"
          title={`More colors (current ${label.toLowerCase()}: ${value})`}
          aria-label={`More colors — open the ${label.toLowerCase()} color picker`}
          onClick={toggle}
        />
      )}
      {pos && (
        <ColorPickerPopover
          value={value}
          allowTransparent={allowTransparent}
          transparentLabel={transparentLabel}
          onLive={onLive}
          onCommit={onCommit}
          onClose={() => setPos(null)}
          position={pos}
        />
      )}
    </div>
  );
}
