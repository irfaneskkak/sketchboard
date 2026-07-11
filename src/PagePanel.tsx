import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
import { LayersPanel } from './LayersPanel';
import { ensureImagesLoaded, pageRenderBox, renderPageToCanvas } from './render';
import { pageSize } from './types';
import type {
  SketchElement, Doc, Page } from './types';

const THUMB_WIDTH = 236; // card ≈ 240px with border; centered in the ≥300px panel
const VIEW_MODE_KEY = 'sketchboard-page-view';
const PANEL_WIDTH_KEY = 'sketchboard-page-width';
const PANEL_MIN = 300;
const PANEL_MAX = 420;
const PANEL_DEFAULT = 320;

type ViewMode = 'list' | 'thumbnail';

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'thumbnail' ? 'thumbnail' : 'list';
  } catch {
    return 'list';
  }
}

function clampPanelWidth(w: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, w));
}

function loadPanelWidth(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(v) && v > 0 ? clampPanelWidth(v) : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

function PageThumb({ page }: { page: Page }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawnOnceRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      try {
        const { w, h } = pageRenderBox(page);
        const scale = (THUMB_WIDTH / w) * (window.devicePixelRatio || 1);
        const rendered = renderPageToCanvas(page, scale);
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        // Fixed width, height from the page's aspect ratio — never stretched.
        canvas.style.width = `${THUMB_WIDTH}px`;
        canvas.style.height = `${(h / w) * THUMB_WIDTH}px`;
        canvas.getContext('2d')!.drawImage(rendered, 0, 0);
        drawnOnceRef.current = true;
      } catch {
        setFailed(true);
      }
    };
    // First paint is immediate; subsequent edits redraw after a short
    // debounce so rapid canvas changes don't re-render every thumbnail.
    let timer: number | undefined;
    if (!drawnOnceRef.current) {
      draw();
    } else {
      timer = window.setTimeout(draw, 600);
    }
    if (page.elements.some((el) => el.type === 'image')) {
      ensureImagesLoaded([page]).then(() => {
        if (!cancelled) draw();
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page]);

  if (failed) {
    const { w, h } = pageRenderBox(page);
    return <div className="thumb-placeholder" style={{ width: THUMB_WIDTH, height: (h / w) * THUMB_WIDTH }} />;
  }
  return <canvas ref={ref} className="thumb-canvas" />;
}

interface PageMenuProps {
  onRename: () => void;
  onDuplicate: () => void;
  onExport: (format: 'png' | 'svg' | 'pdf') => void;
  onDelete: () => void;
  onClose: () => void;
}

function PageMenu({ onRename, onDuplicate, onExport, onDelete, onClose }: PageMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [exportMode, setExportMode] = useState(false);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const item = (label: string, fn: () => void, danger = false) => (
    <button
      key={label}
      className={`menu-item ${danger ? 'danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
        fn();
      }}
    >
      {label}
    </button>
  );

  if (exportMode) {
    // "Export Page" format picker: exports ONLY this page (Fix 1.21).
    return (
      <div className="page-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="page-menu-title">Export Page</div>
        {item('PNG', () => onExport('png'))}
        {item('SVG', () => onExport('svg'))}
        {item('PDF', () => onExport('pdf'))}
        <button
          className="menu-item"
          onClick={(e) => {
            e.stopPropagation();
            setExportMode(false);
          }}
        >
          ‹ Back
        </button>
      </div>
    );
  }

  return (
    <div className="page-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {item('Rename', onRename)}
      {item('Duplicate', onDuplicate)}
      <button
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation();
          setExportMode(true);
        }}
      >
        Export page…
      </button>
      <div className="page-menu-divider" />
      {item('Delete', onDelete, true)}
    </div>
  );
}

interface Props {
  doc: Doc;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onExportPage: (index: number, format: 'png' | 'svg' | 'pdf') => void;
  onReorderPage: (from: number, to: number) => void;
  onRenamePage: (index: number, name: string) => void;
  /** Layers panel wiring (Layer Implementation). */
  elements: SketchElement[];
  selection: string[];
  onSelectLayers: (ids: string[]) => void;
  onPatchLayer: (id: string, patch: Partial<SketchElement>) => void;
  onReorderLayer: (srcId: string, dstId: string, place: 'above' | 'below') => void;
}

export function PagePanel(props: Props) {
  const { doc, collapsed } = props;
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [panelWidth, setPanelWidth] = useState<number>(loadPanelWidth);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    setPanelWidth(clampPanelWidth(resizeRef.current.startW + (e.clientX - resizeRef.current.startX)));
  };
  const onResizeUp = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  };

  if (collapsed) {
    return (
      <div className="page-panel collapsed">
        <button className="icon-btn" onClick={props.onToggleCollapsed} title="Show pages">
          {Icons.pages}
        </button>
        <span className="page-count-mini">{doc.pages.length}</span>
      </div>
    );
  }

  const dragProps = (i: number) => ({
    draggable: renaming !== i,
    onDragStart: (e: React.DragEvent) => {
      setDragIndex(i);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null && i !== dragIndex) setDropIndex(i);
    },
    onDragLeave: () => setDropIndex((d) => (d === i ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== i) props.onReorderPage(dragIndex, i);
      setDragIndex(null);
      setDropIndex(null);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setDropIndex(null);
    },
    onClick: () => props.onSelectPage(i),
  });

  const renameInput = (page: Page, i: number) => (
    <input
      className="page-name-input"
      defaultValue={page.name}
      autoFocus
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        props.onRenamePage(i, e.target.value.trim() || page.name);
        setRenaming(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setRenaming(null);
        e.stopPropagation();
      }}
    />
  );

  const menuButton = (i: number) => (
    <span className="page-menu-anchor">
      <button
        className="icon-btn small page-menu-btn"
        title="Page options"
        aria-label="Page options"
        onClick={(e) => {
          e.stopPropagation();
          setMenuIndex((m) => (m === i ? null : i));
        }}
      >
        {Icons.dots}
      </button>
      {menuIndex === i && (
        <PageMenu
          onRename={() => setRenaming(i)}
          onDuplicate={() => props.onDuplicatePage(i)}
          onExport={(format) => props.onExportPage(i, format)}
          onDelete={() => props.onDeletePage(i)}
          onClose={() => setMenuIndex(null)}
        />
      )}
    </span>
  );

  return (
    <div className="page-panel" aria-label="Pages" style={{ width: panelWidth }}>
      <div className="page-panel-header">
        <span className="pages-title">Pages</span>
        <span className="page-panel-header-actions">
          <button
            className={`icon-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => changeView('list')}
            title="List view"
            aria-pressed={viewMode === 'list'}
          >
            {Icons.list}
          </button>
          <button
            className={`icon-btn ${viewMode === 'thumbnail' ? 'active' : ''}`}
            onClick={() => changeView('thumbnail')}
            title="Thumbnail view"
            aria-pressed={viewMode === 'thumbnail'}
          >
            {Icons.grid}
          </button>
          <button className="icon-btn" onClick={props.onAddPage} title="Add page">
            {Icons.plus}
          </button>
          <button className="icon-btn" onClick={props.onToggleCollapsed} title="Hide page panel">
            {Icons.chevronLeft}
          </button>
        </span>
      </div>

      {viewMode === 'list' ? (
        <div className="page-list list-mode">
          {doc.pages.map((page, i) => (
            <div
              key={page.id}
              className={`page-row ${i === doc.currentPage ? 'active' : ''} ${dropIndex === i ? 'drop-target' : ''}`}
              {...dragProps(i)}
            >
              {renaming === i ? (
                renameInput(page, i)
              ) : (
                <span
                  className="page-name"
                  title="Double-click to rename"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming(i);
                  }}
                >
                  {page.name}
                </span>
              )}
              {menuButton(i)}
            </div>
          ))}
        </div>
      ) : (
        <div className="page-list">
          {doc.pages.map((page, i) => (
            <div
              key={page.id}
              className={`page-item ${i === doc.currentPage ? 'active' : ''} ${dropIndex === i ? 'drop-target' : ''}`}
              {...dragProps(i)}
            >
              <PageThumb page={page} />
              <div className="page-item-footer">
                <span className="page-num">{i + 1}</span>
                {renaming === i ? (
                  renameInput(page, i)
                ) : (
                  <span
                    className="page-name"
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenaming(i);
                    }}
                  >
                    {page.name}
                  </span>
                )}
                {menuButton(i)}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="add-page-btn" onClick={props.onAddPage} title="Add page (Appends a new A4 page)">
        {Icons.plus} <span>Add page</span>
      </button>

      <LayersPanel
        elements={props.elements}
        selection={props.selection}
        onSelect={props.onSelectLayers}
        onPatch={props.onPatchLayer}
        onReorder={props.onReorderLayer}
      />
      <div
        className="page-resize-handle"
        title="Drag to resize the Pages panel"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
      />
    </div>
  );
}
