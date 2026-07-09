import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ColorPickerButton } from './ColorPicker';
import { Icons } from './Icons';
import { isTextContainer } from './render';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, normalizeUrl } from './types';
import { boundsUnion, clampCornerRadius, getBounds } from './geometry';
import { isGroupElement, isGroupableElement, selectedGroupRoots } from './elementOps';
import type { AlignAction, DistributeAction, ZAction } from './elementOps';
import type { SketchElement, StrokeStyle, StyleDefaults, Tool, Point } from './types';

export interface StylePatch {
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  opacity?: number;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  autoTextContrast?: boolean;
  rotation?: number;
  cornerRadius?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  fillVisible?: boolean;
  strokeVisible?: boolean;
  controlPoint?: Point | null;
  arrowType?: 'straight' | 'curved';
  arrowHead?: 'none' | 'start' | 'end' | 'both';
}

/** Add / edit / open / copy / remove a hyperlink on the selection. */
function LinkSection({
  currentLink,
  onSetLink,
}: {
  currentLink: string | null;
  onSetLink: (url: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLink ?? '');
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the selection changes.
  useEffect(() => {
    setValue(currentLink ?? '');
    setEditing(false);
    setError(null);
  }, [currentLink]);

  const save = () => {
    const normalized = normalizeUrl(value);
    if (!normalized) {
      setError('Enter a valid URL (https://, mailto:, tel:, or a domain).');
      return;
    }
    setError(null);
    setEditing(false);
    onSetLink(normalized);
  };

  if (!editing && !currentLink) {
    return (
      <section>
        <h4>Link</h4>
        <button className="toolbar-btn link-add-btn" onClick={() => setEditing(true)}>
          + Add link
        </button>
      </section>
    );
  }

  return (
    <section>
      <h4>Link</h4>
      {editing || !currentLink ? (
        <>
          <input
            className="link-input"
            type="text"
            value={value}
            placeholder="Paste or type URL"
            spellCheck={false}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                setEditing(false);
                setError(null);
                setValue(currentLink ?? '');
              }
            }}
          />
          {error && <div className="link-error">{error}</div>}
          <div className="btn-row">
            <button className="chip" onClick={save}>
              Save
            </button>
            <button
              className="chip"
              onClick={() => {
                setEditing(false);
                setError(null);
                setValue(currentLink ?? '');
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="link-url" title={currentLink}>
            {currentLink}
          </div>
          <div className="btn-row">
            <button className="chip" title="Open link in a new tab" onClick={() => window.open(currentLink, '_blank', 'noopener')}>
              Open
            </button>
            <button
              className="chip"
              title="Copy link"
              onClick={() => navigator.clipboard?.writeText(currentLink).catch(() => undefined)}
            >
              Copy
            </button>
            <button className="chip" title="Edit link" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="chip danger" title="Remove link" onClick={() => onSetLink(null)}>
              Remove
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Compact Figma-style paint row: swatch · HEX · opacity% · eye · minus (Fix 1.24). */
function PaintRow({
  kind,
  color,
  mixed,
  opacity,
  visible,
  hasSelection,
  onStyle,
  onStyleLive,
  onStyleEnd,
}: {
  kind: 'fill' | 'stroke';
  color: string;
  mixed: boolean;
  opacity: number;
  visible: boolean;
  hasSelection: boolean;
  onStyle: (patch: StylePatch) => void;
  onStyleLive: (patch: StylePatch) => void;
  onStyleEnd: () => void;
}) {
  const colorKey = kind === 'fill' ? 'fillColor' : 'strokeColor';
  const opKey = kind === 'fill' ? 'fillOpacity' : 'strokeOpacity';
  const visKey = kind === 'fill' ? 'fillVisible' : 'strokeVisible';
  const title = kind === 'fill' ? 'Fill' : 'Stroke';
  const exists = mixed || color !== 'transparent';
  const [hex, setHex] = useState('');
  const [hexError, setHexError] = useState(false);

  useEffect(() => {
    setHex(!mixed && color !== 'transparent' ? color.replace('#', '').toUpperCase() : '');
    setHexError(false);
  }, [color, mixed]);

  const commitHex = () => {
    const v = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(v) || /^[0-9a-fA-F]{3}$/.test(v)) {
      const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
      setHexError(false);
      onStyle({ [colorKey]: `#${full.toLowerCase()}` } as StylePatch);
    } else if (v === '') {
      setHex(!mixed && color !== 'transparent' ? color.replace('#', '').toUpperCase() : '');
      setHexError(false);
    } else {
      setHexError(true);
    }
  };

  return (
    <section className="paint-section">
      <div className="paint-header">
        <h4>{title}</h4>
        <button
          className="icon-btn small"
          disabled={exists}
          title={`Add ${kind}`}
          aria-label={`Add ${kind}`}
          onClick={() =>
            onStyle({ [colorKey]: kind === 'fill' ? '#D9D9D9' : '#1a1a1a', [visKey]: true } as StylePatch)
          }
        >
          {Icons.plus}
        </button>
      </div>
      {exists && (
        <div className={`paint-row ${visible ? '' : 'paint-hidden'}`}>
          <ColorPickerButton
            variant="swatch"
            value={mixed ? '#888888' : color}
            label={title}
            onLive={(c) => onStyleLive({ [colorKey]: c } as StylePatch)}
            onCommit={(c) => {
              onStyleLive({ [colorKey]: c } as StylePatch);
              onStyleEnd();
            }}
          />
          <input
            className={`paint-hex ${hexError ? 'error' : ''}`}
            value={hex}
            placeholder={mixed ? 'Mixed' : ''}
            spellCheck={false}
            onChange={(e) => {
              setHex(e.target.value.toUpperCase());
              setHexError(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitHex();
            }}
            onBlur={commitHex}
            aria-label={`${title} hex color`}
          />
          {hasSelection && (
            <>
              <input
                className="paint-opacity"
                type="number"
                min={0}
                max={100}
                value={Math.round(opacity)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    onStyle({ [opKey]: Math.min(100, Math.max(0, Math.round(v))) } as StylePatch);
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={`${title} opacity percent`}
              />
              <span className="paint-pct">%</span>
              <button
                className="icon-btn small"
                title={visible ? `Hide ${kind}` : `Show ${kind}`}
                aria-label={visible ? `Hide ${kind}` : `Show ${kind}`}
                onClick={() => onStyle({ [visKey]: !visible } as StylePatch)}
              >
                {visible ? Icons.eye : Icons.eyeOff}
              </button>
            </>
          )}
          <button
            className="icon-btn small"
            title={`Remove ${kind}`}
            aria-label={`Remove ${kind}`}
            onClick={() => onStyle({ [colorKey]: 'transparent' } as StylePatch)}
          >
            {Icons.minus}
          </button>
        </div>
      )}
    </section>
  );
}

/** Text color as a compact paint row: swatch · HEX. Text always has a color,
 * so there is no add/remove or visibility toggle. */
function TextColorRow({
  color,
  mixed,
  onStyle,
  onStyleLive,
  onStyleEnd,
}: {
  color: string;
  mixed: boolean;
  onStyle: (patch: StylePatch) => void;
  onStyleLive: (patch: StylePatch) => void;
  onStyleEnd: () => void;
}) {
  const [hex, setHex] = useState('');
  const [hexError, setHexError] = useState(false);

  useEffect(() => {
    setHex(!mixed ? color.replace('#', '').toUpperCase() : '');
    setHexError(false);
  }, [color, mixed]);

  const commitHex = () => {
    const v = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(v) || /^[0-9a-fA-F]{3}$/.test(v)) {
      const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
      setHexError(false);
      onStyle({ textColor: `#${full.toLowerCase()}` });
    } else if (v === '') {
      setHex(!mixed ? color.replace('#', '').toUpperCase() : '');
      setHexError(false);
    } else {
      setHexError(true);
    }
  };

  return (
    <div className="paint-row">
      <ColorPickerButton
        variant="swatch"
        value={mixed ? '#888888' : color}
        label="Text color"
        onLive={(c) => onStyleLive({ textColor: c })}
        onCommit={(c) => {
          onStyleLive({ textColor: c });
          onStyleEnd();
        }}
      />
      <input
        className={`paint-hex ${hexError ? 'error' : ''}`}
        value={hex}
        placeholder={mixed ? 'Mixed' : ''}
        spellCheck={false}
        onChange={(e) => {
          setHex(e.target.value.toUpperCase());
          setHexError(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitHex();
        }}
        onBlur={commitHex}
        aria-label="Text hex color"
      />
    </div>
  );
}

function clampFont(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

interface Props {
  selected: SketchElement[];
  defaults: StyleDefaults;
  tool: Tool;
  /** Discrete change: applied and committed to history immediately. */
  onStyle: (patch: StylePatch) => void;
  /** Continuous change (slider/picker drag): applied without a history entry. */
  onStyleLive: (patch: StylePatch) => void;
  /** End of a continuous change: closes the gesture, records one history entry. */
  onStyleEnd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onZOrder: (action: ZAction) => void;
  onAlign: (action: AlignAction) => void;
  onDistribute: (action: DistributeAction) => void;
  /** Single non-frame selection whose center sits inside a frame: alignment
   * targets the parent frame (Fix 1.38). */
  singleInFrame: boolean;
  onResizeDimensions: (dimensions: { width?: number; height?: number }, commit?: boolean) => void;
  onResizeDimensionsEnd: () => void;
  ratioLocked: boolean;
  onToggleRatioLock: () => void;
  onSetLink: (url: string | null) => void;
  /** Image tools (Fix 1.43): enter crop mode / apply a fitting mode. */
  onCropImage: () => void;
  onImageFit: (mode: 'fill' | 'fit' | 'reset') => void;
  /** Release the selected image's clipping mask (Fix 1.44). */
  onReleaseMask: () => void;
  /** Clip the selected image into the topmost selected shape (Fix 1.45.4
   * menu fallback for browsers that reserve Cmd/Ctrl+7). */
  onMakeMask: () => void;
  onSetFrameName: (id: string, name: string) => void;
  onExportFrame: (format: 'png' | 'svg' | 'pdf') => void;
  onSetFrameOrientation: (orientation: 'portrait' | 'landscape') => void;
}

function StrokeStylePreview({ style }: { style: StrokeStyle }) {
  const dash = style === 'dashed' ? '6 4' : style === 'dotted' ? '0.1 5' : undefined;
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
      <line
        x1="2"
        y1="5"
        x2="26"
        y2="5"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatDimension(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function DimensionsControls({
  selected,
  ratioLocked,
  onToggleRatioLock,
  onResizeDimensions,
  onResizeDimensionsEnd,
}: {
  selected: SketchElement[];
  ratioLocked: boolean;
  onToggleRatioLock: () => void;
  onResizeDimensions: (dimensions: { width?: number; height?: number }, commit?: boolean) => void;
  onResizeDimensionsEnd: () => void;
}) {
  const bounds = selected.length > 0 ? boundsUnion(selected.map(getBounds)) : null;
  const width = bounds?.w ?? 0;
  const height = bounds?.h ?? 0;
  const selectionKey = selected.map((el) => el.id).join('|');
  const [aspectRatio, setAspectRatio] = useState(width > 0 && height > 0 ? width / height : 1);
  const [widthText, setWidthText] = useState(formatDimension(width));
  const [heightText, setHeightText] = useState(formatDimension(height));
  const skipNextBlurRef = useRef(false);
  const liveEditRef = useRef(false);

  useEffect(() => {
    setAspectRatio(width > 0 && height > 0 ? width / height : 1);
    setWidthText(formatDimension(width));
    setHeightText(formatDimension(height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // Capture the ratio the moment the lock engages and keep it fixed while
  // locked (no per-edit recapture — that would drift).
  useEffect(() => {
    if (ratioLocked && width > 0 && height > 0) setAspectRatio(width / height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratioLocked]);

  useEffect(() => {
    setWidthText(formatDimension(width));
    setHeightText(formatDimension(height));
  }, [width, height]);

  const validDimension = (raw: string): number | null => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return null;
    return Math.min(10000, value);
  };

  const resetTexts = () => {
    setWidthText(formatDimension(width));
    setHeightText(formatDimension(height));
  };

  const dimensionsFor = (axis: 'width' | 'height', raw: string): { width?: number; height?: number } | null => {
    const clamped = validDimension(raw);
    if (clamped == null) return null;
    if (ratioLocked && aspectRatio > 0) {
      return axis === 'width'
        ? { width: clamped, height: clamped / aspectRatio }
        : { width: clamped * aspectRatio, height: clamped };
    }
    return axis === 'width' ? { width: clamped } : { height: clamped };
  };

  const syncTextsFor = (axis: 'width' | 'height', raw: string) => {
    const next = dimensionsFor(axis, raw);
    if (!next) return;
    if (axis === 'width' && next.height !== undefined) setHeightText(formatDimension(next.height));
    if (axis === 'height' && next.width !== undefined) setWidthText(formatDimension(next.width));
  };

  const updateWidthText = (raw: string) => {
    setWidthText(raw);
    syncTextsFor('width', raw);
    const next = dimensionsFor('width', raw);
    if (!next) return;
    liveEditRef.current = true;
    onResizeDimensions(next, false);
  };

  const updateHeightText = (raw: string) => {
    setHeightText(raw);
    syncTextsFor('height', raw);
    const next = dimensionsFor('height', raw);
    if (!next) return;
    liveEditRef.current = true;
    onResizeDimensions(next, false);
  };

  const apply = (axis: 'width' | 'height', rawOverride?: string) => {
    if (skipNextBlurRef.current) {
      skipNextBlurRef.current = false;
      return;
    }
    const raw = rawOverride ?? (axis === 'width' ? widthText : heightText);
    const next = dimensionsFor(axis, raw);
    if (liveEditRef.current) {
      liveEditRef.current = false;
      if (!next) resetTexts();
      onResizeDimensionsEnd();
      return;
    }
    if (!next) {
      resetTexts();
      return;
    }
    if (next.width !== undefined) setWidthText(formatDimension(next.width));
    if (next.height !== undefined) setHeightText(formatDimension(next.height));
    onResizeDimensions(next, true);
  };

  const onKeyDown = (axis: 'width' | 'height') => (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Whole-number stepping that preserves the decimal part (Fix 1.40):
      // 34.11 → 35.11, Shift steps by 5. The browser's own number stepping
      // (which would give 34.12) is suppressed.
      e.preventDefault();
      const raw = axis === 'width' ? widthText : heightText;
      const cur = Number(raw);
      const base = Number.isFinite(cur) && raw.trim() !== '' ? cur : axis === 'width' ? width : height;
      const step = (e.shiftKey ? 5 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      const stepped = Math.round(Math.min(10000, Math.max(1, base + step)) * 100) / 100;
      const next = dimensionsFor(axis, String(stepped));
      if (!next) return;
      if (next.width !== undefined) setWidthText(formatDimension(next.width));
      if (next.height !== undefined) setHeightText(formatDimension(next.height));
      if (liveEditRef.current) {
        // Close a live typing gesture before committing the discrete step.
        liveEditRef.current = false;
        onResizeDimensionsEnd();
      }
      onResizeDimensions(next, true); // discrete: each press is one undo step
      return;
    }
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      skipNextBlurRef.current = true;
      liveEditRef.current = false;
      onResizeDimensionsEnd();
      resetTexts();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="dimensions-row" aria-label="Dimensions">
      <label className="dimension-field">
        <span>W</span>
        <input
          type="number"
          min={1}
          max={10000}
          step="0.01"
          value={widthText}
          onChange={(e) => updateWidthText(e.target.value)}
          onBlur={(e) => apply('width', e.currentTarget.value)}
          onKeyDown={onKeyDown('width')}
          aria-label="Width"
        />
      </label>
      <label className="dimension-field">
        <span>H</span>
        <input
          type="number"
          min={1}
          max={10000}
          step="0.01"
          value={heightText}
          onChange={(e) => updateHeightText(e.target.value)}
          onBlur={(e) => apply('height', e.currentTarget.value)}
          onKeyDown={onKeyDown('height')}
          aria-label="Height"
        />
      </label>
      <button
        className={`icon-btn dimension-lock ${ratioLocked ? 'active' : ''}`}
        onClick={onToggleRatioLock}
        title={ratioLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        aria-pressed={ratioLocked}
      >
        {ratioLocked ? Icons.lock : Icons.unlock}
      </button>
    </div>
  );
}

export function PropertiesPanel(props: Props) {
  const { defaults, tool, onStyle, onStyleLive, onStyleEnd } = props;
  const allSelected = props.selected;
  const selected = allSelected.filter((el) => el.type !== 'group');
  const selectedIds = new Set(allSelected.map((el) => el.id));
  const selectedRoots = selectedGroupRoots(allSelected, selectedIds);
  const canGroup = selectedRoots.filter(isGroupableElement).length >= 2;
  const canUngroup = selectedRoots.some(isGroupElement);
  const hasSelection = selected.length > 0;
  const first = selected[0];

  const current = {
    strokeColor: first?.strokeColor ?? defaults.strokeColor,
    fillColor: first?.fillColor ?? defaults.fillColor,
    strokeWidth: first?.strokeWidth ?? defaults.strokeWidth,
    strokeStyle: first?.strokeStyle ?? defaults.strokeStyle,
    opacity: first?.opacity ?? defaults.opacity,
    fontSize: first?.fontSize ?? defaults.fontSize,
    textAlign: first?.textAlign ?? defaults.textAlign,
    textColor: first?.textColor ?? defaults.textColor,
  };

  const showFont =
    tool === 'text' ||
    tool === 'sticky' ||
    selected.some((el) => el.type === 'text' || el.type === 'sticky' || el.text != null);
  const containedTextSelected = selected.filter(
    (el) => !!el.text && (el.type === 'sticky' || isTextContainer(el))
  );
  const autoContrastOn =
    containedTextSelected.length > 0 && containedTextSelected.every((el) => el.autoTextContrast !== false);
  const anyLocked = selected.some((el) => el.locked);
  // Context-aware capability model (Fix 1.26): a section renders only when
  // EVERY selected element supports it — or, with nothing selected, when the
  // active drawing tool would create an element that supports it.
  const FILLABLE = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'sticky', 'frame']);
  const STROKEABLE = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'freedraw', 'frame']);
  const FILL_TOOLS = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'sticky', 'frame']);
  const STROKE_TOOLS = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'pencil', 'frame']);
  const DRAW_TOOLS = new Set([
    'rectangle', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'pencil', 'text', 'sticky', 'frame',
  ]);
  const showFill = hasSelection ? selected.every((el) => FILLABLE.has(el.type)) : FILL_TOOLS.has(tool);
  const showStroke = hasSelection ? selected.every((el) => STROKEABLE.has(el.type)) : STROKE_TOOLS.has(tool);
  const showOpacity = hasSelection || DRAW_TOOLS.has(tool);
  const panelEmpty = !hasSelection && !showFill && !showStroke && !showFont && !showOpacity;

  return (
    <div className="props-panel" aria-label="Style and object controls">
      {selected.length === 1 && first?.type === 'frame' && !first.locked && (
        <section>
          <h4>Orientation</h4>
          <div className="btn-row">
            <button
              className={`chip ${first.height >= first.width ? 'active' : ''}`}
              title="Portrait"
              aria-pressed={first.height >= first.width}
              onClick={() => props.onSetFrameOrientation('portrait')}
            >
              {Icons.portrait}
            </button>
            <button
              className={`chip ${first.width > first.height ? 'active' : ''}`}
              title="Landscape"
              aria-pressed={first.width > first.height}
              onClick={() => props.onSetFrameOrientation('landscape')}
            >
              {Icons.landscape}
            </button>
          </div>
        </section>
      )}

      {panelEmpty && (
        <div className="panel-empty">Select an object to edit its properties.</div>
      )}

      {hasSelection && (
        <section className="position-section">
          <h4>Position</h4>
          {(selected.length >= 2 || props.singleInFrame) && (
            <>
              <div className="section-subtitle">Alignment</div>
              <div className="alignment-controls position-toolbar">
                <div className="alignment-group" aria-label="Horizontal alignment">
                  <button className="icon-btn" onClick={() => props.onAlign('left')} title="Align left">
                    {Icons.alignLeft}
                  </button>
                  <button className="icon-btn" onClick={() => props.onAlign('centerX')} title="Align horizontal center">
                    {Icons.alignCenterX}
                  </button>
                  <button className="icon-btn" onClick={() => props.onAlign('right')} title="Align right">
                    {Icons.alignRight}
                  </button>
                </div>
                <div className="alignment-group" aria-label="Vertical alignment">
                  <button className="icon-btn" onClick={() => props.onAlign('top')} title="Align top">
                    {Icons.alignTop}
                  </button>
                  <button className="icon-btn" onClick={() => props.onAlign('centerY')} title="Align vertical middle">
                    {Icons.alignCenterY}
                  </button>
                  <button className="icon-btn" onClick={() => props.onAlign('bottom')} title="Align bottom">
                    {Icons.alignBottom}
                  </button>
                </div>
                {selected.length >= 2 && (
                  <div className="alignment-group" aria-label="Distribution">
                    <button className="icon-btn" onClick={() => props.onDistribute('horizontal')} title="Distribute horizontally">
                      {Icons.distributeHorizontal}
                    </button>
                    <button className="icon-btn" onClick={() => props.onDistribute('vertical')} title="Distribute vertically">
                      {Icons.distributeVertical}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="section-subtitle dimensions-label">Dimensions</div>
          <DimensionsControls
            selected={selected}
            ratioLocked={props.ratioLocked}
            onToggleRatioLock={props.onToggleRatioLock}
            onResizeDimensions={props.onResizeDimensions}
            onResizeDimensionsEnd={props.onResizeDimensionsEnd}
          />
        </section>
      )}

      {selected.length === 1 && first?.type === 'image' && (
        <section>
          <h4>Image</h4>
          <div className="btn-row">
            <button className="chip" title="Edit which part of the image is visible (or double-click the image)" onClick={props.onCropImage}>
              Crop
            </button>
            <button className="chip" title="Cover the frame, keeping aspect ratio" onClick={() => props.onImageFit('fill')}>
              Fill
            </button>
            <button className="chip" title="Show the whole image inside the frame" onClick={() => props.onImageFit('fit')}>
              Fit
            </button>
            <button className="chip" title="Remove the crop" onClick={() => props.onImageFit('reset')}>
              Reset crop
            </button>
          </div>
        </section>
      )}

      {showFill && (
        <PaintRow
          kind="fill"
          color={current.fillColor}
          mixed={selected.length > 1 && selected.some((el) => el.fillColor !== first.fillColor)}
          opacity={first?.fillOpacity ?? 100}
          visible={first?.fillVisible !== false}
          hasSelection={hasSelection}
          onStyle={onStyle}
          onStyleLive={onStyleLive}
          onStyleEnd={onStyleEnd}
        />
      )}

      {showStroke && (
        <PaintRow
          kind="stroke"
          color={current.strokeColor}
          mixed={selected.length > 1 && selected.some((el) => el.strokeColor !== first.strokeColor)}
          opacity={first?.strokeOpacity ?? 100}
          visible={first?.strokeVisible !== false}
          hasSelection={hasSelection}
          onStyle={onStyle}
          onStyleLive={onStyleLive}
          onStyleEnd={onStyleEnd}
        />
      )}

      {showStroke && (
        <section>
          <h4>Stroke width · {Math.round(current.strokeWidth * 10) / 10}px</h4>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            value={current.strokeWidth}
            onChange={(e) => onStyleLive({ strokeWidth: Number(e.target.value) })}
            onPointerUp={onStyleEnd}
            onKeyUp={onStyleEnd}
            aria-label="Stroke width"
          />
        </section>
      )}

      {showStroke && (
        <section>
          <h4>Stroke style</h4>
          <div className="btn-row">
            {(['solid', 'dashed', 'dotted'] as const).map((s) => (
              <button
                key={s}
                className={`chip ${current.strokeStyle === s ? 'active' : ''}`}
                onClick={() => onStyle({ strokeStyle: s })}
                title={s[0].toUpperCase() + s.slice(1)}
                aria-pressed={current.strokeStyle === s}
              >
                <StrokeStylePreview style={s} />
              </button>
            ))}
          </div>
        </section>
      )}

      {(hasSelection
        ? selected.every((el) => el.type === 'line' || el.type === 'arrow')
        : tool === 'line' || tool === 'arrow') && (
        <section>
          <h4>Arrowheads</h4>
          <div className="btn-row">
            {(
              [
                ['none', 'None'],
                ['start', 'Start'],
                ['end', 'End'],
                ['both', 'Both'],
              ] as const
            ).map(([mode, label]) => {
              const headOf = (el: SketchElement) =>
                el.arrowHead ?? (el.type === 'arrow' ? 'end' : 'none');
              const values = hasSelection
                ? [...new Set(selected.map(headOf))]
                : [defaults.arrowHead ?? (tool === 'arrow' ? 'end' : 'none')];
              const active = values.length === 1 && values[0] === mode;
              return (
                <button
                  key={mode}
                  className={`chip ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  title={`Arrowhead: ${label.toLowerCase()}`}
                  onClick={() => onStyle({ arrowHead: mode })}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {showOpacity && (
        <section>
          <h4>Opacity · {Math.round(current.opacity)}%</h4>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={current.opacity}
            onChange={(e) => onStyleLive({ opacity: Number(e.target.value) })}
            onPointerUp={onStyleEnd}
            onKeyUp={onStyleEnd}
            aria-label="Opacity"
          />
        </section>
      )}

      {showFont && (
        <>
          <section className="paint-section">
            <div className="paint-header">
              <h4>Text color</h4>
            </div>
            <TextColorRow
              color={current.textColor}
              mixed={
                selected.length > 1 &&
                selected.some(
                  (el) => (el.textColor ?? defaults.textColor) !== (first.textColor ?? defaults.textColor)
                )
              }
              onStyle={onStyle}
              onStyleLive={onStyleLive}
              onStyleEnd={onStyleEnd}
            />
            {containedTextSelected.length > 0 && (
              <label className="auto-contrast-row" title="Pick black or white automatically from the fill color">
                <input
                  type="checkbox"
                  checked={autoContrastOn}
                  onChange={(e) => onStyle({ autoTextContrast: e.target.checked })}
                />
                <span>Auto contrast</span>
              </label>
            )}
          </section>

          <section>
            <h4>Font size · {Math.round(current.fontSize)}px</h4>
            <div className="font-size-row">
              <button
                className="chip"
                title="Decrease font size"
                aria-label="Decrease font size"
                onClick={() => onStyle({ fontSize: clampFont(current.fontSize - 2) })}
              >
                −
              </button>
              <input
                className="font-size-input"
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                value={Math.round(current.fontSize)}
                aria-label="Font size"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= FONT_SIZE_MIN) onStyle({ fontSize: clampFont(v) });
                }}
              />
              <button
                className="chip"
                title="Increase font size"
                aria-label="Increase font size"
                onClick={() => onStyle({ fontSize: clampFont(current.fontSize + 2) })}
              >
                +
              </button>
            </div>
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step="1"
              value={clampFont(current.fontSize)}
              onChange={(e) => onStyleLive({ fontSize: Number(e.target.value) })}
              onPointerUp={onStyleEnd}
              onKeyUp={onStyleEnd}
              aria-label="Font size slider"
            />
          </section>

          <section>
            <h4>Alignment</h4>
            <div className="btn-row">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  className={`chip ${current.textAlign === a ? 'active' : ''}`}
                  onClick={() => onStyle({ textAlign: a })}
                  title={`Align ${a}`}
                >
                  {a === 'left' ? Icons.alignLeft : a === 'center' ? Icons.alignCenterX : Icons.alignRight}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {hasSelection && (
        <>
          {selected.length === 1 && first?.type === 'frame' && (
            <section>
              <h4>Frame</h4>
              <input
                className="link-input"
                type="text"
                value={first.label ?? ''}
                placeholder="Frame name"
                spellCheck={false}
                onChange={(e) => props.onSetFrameName(first.id, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Frame name"
              />
              <div className="btn-row">
                <button className="chip" title="Export this frame as PNG" onClick={() => props.onExportFrame('png')}>
                  PNG
                </button>
                <button className="chip" title="Export this frame as SVG" onClick={() => props.onExportFrame('svg')}>
                  SVG
                </button>
                <button className="chip" title="Export this frame as PDF" onClick={() => props.onExportFrame('pdf')}>
                  PDF
                </button>
              </div>
            </section>
          )}

          {selected.some((el) => !el.points) && (
            <section>
              <h4>Rotation</h4>
              <div className="font-size-row">
                <input
                  className="font-size-input"
                  type="number"
                  min={0}
                  max={359}
                  value={Math.round(((first?.rotation ?? 0) % 360 + 360) % 360)}
                  aria-label="Rotation angle in degrees"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onStyle({ rotation: ((Math.round(v) % 360) + 360) % 360 });
                  }}
                />
                <span className="rotation-unit">deg</span>
                <button className="chip" title="Reset rotation" onClick={() => onStyle({ rotation: 0 })}>
                  0°
                </button>
              </div>
            </section>
          )}

          <LinkSection currentLink={first?.link ?? null} onSetLink={props.onSetLink} />

          {/* Corner Radius — shapes and clipping-mask shapes alike */}
          {selected.length === 1 &&
            first &&
            (first.type === 'rectangle' ||
              first.type === 'diamond' ||
              first.type === 'triangle' ||
              (first.type === 'image' && first.mask && first.mask.type !== 'ellipse')) && (
            <section>
              <h4>
                Corner radius ·{' '}
                {Math.round((first.type === 'image' ? first.mask?.cornerRadius : first.cornerRadius) ?? 0)}px
              </h4>
              <div className="font-size-row">
                <input
                  className="font-size-input"
                  type="number"
                  min={0}
                  max={Math.round(Math.min(first.width, first.height) / 2)}
                  value={Math.round((first.type === 'image' ? first.mask?.cornerRadius : first.cornerRadius) ?? 0)}
                  aria-label="Corner radius"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onStyle({ cornerRadius: clampCornerRadius(v, first.width, first.height) });
                  }}
                />
                <span className="rotation-unit">px</span>
                <button className="chip" title="Reset corner radius" onClick={() => onStyle({ cornerRadius: 0 })}>0</button>
              </div>
              <input
                type="range"
                min="0"
                max={Math.round(Math.min(first.width, first.height) / 2)}
                step="1"
                value={Math.round(
                  clampCornerRadius(
                    (first.type === 'image' ? first.mask?.cornerRadius : first.cornerRadius) ?? 0,
                    first.width,
                    first.height
                  )
                )}
                onChange={(e) => onStyleLive({ cornerRadius: Number(e.target.value) })}
                onPointerUp={onStyleEnd}
                onKeyUp={onStyleEnd}
                aria-label="Corner radius slider"
              />
            </section>
          )}

          {/* Arrow Curve — shown for single arrow/line */}
          {selected.length === 1 && (first?.type === 'arrow' || first?.type === 'line') && first.points?.length === 2 && (
            <section>
              <h4>Arrow curve</h4>
              <div className="btn-row">
                <button
                  className={`chip ${(first.arrowType ?? 'straight') === 'straight' ? 'active' : ''}`}
                  onClick={() => onStyle({ arrowType: 'straight', controlPoint: null })}
                  title="Straight"
                >
                  Straight
                </button>
                <button
                  className={`chip ${first.arrowType === 'curved' ? 'active' : ''}`}
                  onClick={() => {
                    if (!first.controlPoint) {
                      // Default control point: perpendicular offset from midpoint
                      const pts = first.points!;
                      const mx = (pts[0][0] + pts[1][0]) / 2;
                      const my = (pts[0][1] + pts[1][1]) / 2;
                      const dx = pts[1][0] - pts[0][0];
                      const dy = pts[1][1] - pts[0][1];
                      const len = Math.hypot(dx, dy) || 1;
                      const offset = len * 0.3;
                      onStyle({ arrowType: 'curved', controlPoint: [mx + (-dy / len) * offset, my + (dx / len) * offset] });
                    } else {
                      onStyle({ arrowType: 'curved' });
                    }
                  }}
                  title="Curved"
                >
                  Curved
                </button>
              </div>
              {first.arrowType === 'curved' && first.controlPoint && (
                <button
                  className="chip"
                  style={{ marginTop: 6 }}
                  onClick={() => onStyle({ arrowType: 'straight', controlPoint: null })}
                  title="Reset to straight"
                >
                  Reset to straight
                </button>
              )}
            </section>
          )}

          <section>
            <h4>Object</h4>
            <div className="btn-row">
              {selected.length >= 2 &&
                selected.some((el) => el.type === 'image') &&
                selected.some((el) =>
                  el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond' || el.type === 'triangle'
                ) && (
                  <button className="chip" onClick={props.onMakeMask} title="Make clipping mask (Cmd/Ctrl+7 or Cmd/Ctrl+Shift+M)">
                    Make clipping mask
                  </button>
                )}
              {selected.length === 1 && first?.type === 'image' && first.mask && (
                <button className="chip" onClick={props.onReleaseMask} title="Release clipping mask (Cmd/Ctrl+Alt+7 or Cmd/Ctrl+Alt+Shift+M)">
                  Release mask
                </button>
              )}
              <button className="icon-btn" onClick={props.onDuplicate} title="Duplicate (Ctrl/Cmd+D or Alt+drag)">
                {Icons.duplicate}
              </button>
              <button className="icon-btn" onClick={props.onToggleLock} title={anyLocked ? 'Unlock' : 'Lock'}>
                {anyLocked ? Icons.unlock : Icons.lock}
              </button>
              <button
                className="icon-btn"
                onClick={props.onGroup}
                title="Group (Ctrl/Cmd+G)"
                disabled={!canGroup}
              >
                {Icons.group}
              </button>
              <button
                className="icon-btn"
                onClick={props.onUngroup}
                title="Ungroup (Ctrl/Cmd+Shift+G)"
                disabled={!canUngroup}
              >
                {Icons.ungroup}
              </button>
              <button className="icon-btn danger" onClick={props.onDelete} title="Delete (Del)">
                {Icons.trash}
              </button>
            </div>
          </section>

          <section>
            <h4>Layer</h4>
            <div className="btn-row">
              <button className="icon-btn" onClick={() => props.onZOrder('back')} title="Send to back">
                {Icons.toBack}
              </button>
              <button className="icon-btn" onClick={() => props.onZOrder('backward')} title="Send backward">
                {Icons.backward}
              </button>
              <button className="icon-btn" onClick={() => props.onZOrder('forward')} title="Bring forward">
                {Icons.forward}
              </button>
              <button className="icon-btn" onClick={() => props.onZOrder('front')} title="Bring to front">
                {Icons.toFront}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
