import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasArea } from './CanvasArea';
import { CreateCanvasModal } from './CreateCanvasModal';
import { AboutModal } from './AboutModal';
import type { CanvasChoice } from './CreateCanvasModal';
import type { CanvasHandle } from './CanvasArea';
import {
  alignElements,
  cloneElements,
  distributeElements,
  expandWithGroups,
  freeFramePosition,
  nextName,
  removeElements,
  reorderElements,
  resizeSelectionDimensions,
  withFrameContents,
} from './elementOps';
import type { AlignAction, DistributeAction, ZAction } from './elementOps';
import { exportFrame, exportFramesPDF, exportJSON, exportPageAs, exportPDF, exportPNGBundle, exportPNGs, exportSVGs, importJSON } from './export';
import { Icons } from './Icons';
import { getBounds, updateBoundArrows } from './geometry';
import { fileToImageData } from './imageUtils';
import { PagePanel } from './PagePanel';
import { PropertiesPanel } from './PropertiesPanel';
import type { StylePatch } from './PropertiesPanel';
import { clearSession, loadSession, saveSession } from './persistence';
import { contrastTextColor } from './ColorPicker';
import { ensureTextFits, hugBoxedTextHeight, isTextContainer, measureText, textBlockHeight } from './render';
import { Toolbar } from './Toolbar';
import { ToolPanel } from './ToolPanel';
import {
  DEFAULT_STYLE,
  docIsEmpty,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  mainFrame,
  newDoc,
  newInfinitePage,
  newPage,
  pageSize,
  uid,
} from './types';
import type { Doc, Page, Point, SketchElement, Tool } from './types';

const HISTORY_LIMIT = 100;
const ONBOARD_KEY = 'sketchboard-onboarded';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', '1': 'select',
  r: 'rectangle', '2': 'rectangle',
  o: 'ellipse', '3': 'ellipse',
  d: 'diamond', '4': 'diamond',
  l: 'line', '5': 'line',
  a: 'arrow', '6': 'arrow',
  p: 'pencil', '7': 'pencil',
  t: 'text', '8': 'text',
  n: 'sticky', '9': 'sticky',
  i: 'image',
  e: 'eraser', '0': 'eraser',
  k: 'laser',
  f: 'frame',
  y: 'triangle',
};

export default function App() {
  const [doc, setDocState] = useState<Doc>(() => newDoc());
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setToolState] = useState<Tool>('select');
  const [defaults, setDefaults] = useState(DEFAULT_STYLE);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [createCanvasOpen, setCreateCanvasOpen] = useState(false);
  const [, setHistoryTick] = useState(0);

  const docRef = useRef(doc);
  docRef.current = doc;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const undoRef = useRef<Doc[]>([]);
  const redoRef = useRef<Doc[]>([]);
  const gestureBaseRef = useRef<Doc | null>(null);
  const clipboardRef = useRef<SketchElement[]>([]);
  const canvasRef = useRef<CanvasHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const saveFailedRef = useRef(false);
  const prevToolRef = useRef<Tool>('select');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  /* ------------------------------ history / state ----------------------------- */

  const pushUndo = (snapshot: Doc) => {
    undoRef.current.push(snapshot);
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setHistoryTick((t) => t + 1);
  };

  const setDoc = useCallback((next: Doc, commit: boolean) => {
    if (commit) pushUndo(docRef.current);
    // Keep the ref in sync immediately so reads within the same event
    // handler (before React re-renders) see the new state.
    docRef.current = next;
    setDocState(next);
  }, []);

  const getDoc = useCallback(() => docRef.current, []);

  const startGesture = useCallback(() => {
    if (gestureBaseRef.current === null) gestureBaseRef.current = docRef.current;
  }, []);

  const endGesture = useCallback(() => {
    const base = gestureBaseRef.current;
    gestureBaseRef.current = null;
    if (base && base !== docRef.current) pushUndo(base);
  }, []);

  const pruneSelection = (d: Doc) => {
    const ids = new Set(d.pages[d.currentPage].elements.map((e) => e.id));
    setSelection((sel) => sel.filter((id) => ids.has(id)));
  };

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(docRef.current);
    docRef.current = prev;
    setDocState(prev);
    pruneSelection(prev);
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(docRef.current);
    docRef.current = next;
    setDocState(next);
    pruneSelection(next);
    setHistoryTick((t) => t + 1);
  }, []);

  /* ------------------------------ element helpers ----------------------------- */

  const currentElements = () => docRef.current.pages[docRef.current.currentPage].elements;

  const updateElements = useCallback(
    (els: SketchElement[], commit: boolean) => {
      const d = docRef.current;
      const pages = d.pages.map((p, i) => (i === d.currentPage ? { ...p, elements: els } : p));
      setDoc({ ...d, pages }, commit);
    },
    [setDoc]
  );

  const selectedElements = doc.pages[doc.currentPage].elements.filter((el) =>
    selection.includes(el.id)
  );

  /* ----------------------------- aspect-ratio lock ---------------------------- */

  // Shared between the Dimensions inputs and canvas handle resizing
  // (Fix 1.34.1). Defaults per selection: images, multi-selections, and
  // square/circular shapes start locked; everything else starts unlocked.
  const [ratioLocked, setRatioLocked] = useState(false);
  const selectionKey = selection.join('|');
  useEffect(() => {
    const els = docRef.current.pages[docRef.current.currentPage].elements.filter((el) =>
      selectionRef.current.includes(el.id)
    );
    if (els.length === 0) {
      setRatioLocked(false);
      return;
    }
    let locked = els.length > 1;
    if (!locked) {
      const el = els[0];
      const b = getBounds(el);
      locked =
        el.type === 'image' ||
        (b.w > 0 &&
          Math.abs(b.w - b.h) < 0.5 &&
          (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond' || el.type === 'triangle'));
    }
    setRatioLocked(locked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  /* --------------------------------- load / save ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    loadSession().then((session) => {
      if (cancelled) return;
      if (session) {
        docRef.current = session.doc;
        setDocState(session.doc);
        showToast('Restored your last session');
      } else if (!localStorage.getItem(ONBOARD_KEY)) {
        setOnboarding(true);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveSession(doc).catch(() => {
        if (!saveFailedRef.current) {
          saveFailedRef.current = true;
          showToast('Autosave failed — browser storage may be full. Export a JSON backup.');
        }
      });
    }, 350);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [doc, loaded, showToast]);

  useEffect(() => {
    const flush = () => {
      if (loaded) saveSession(docRef.current).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [loaded]);

  /* --------------------------------- page actions ----------------------------- */

  // The plus buttons open the Create New Canvas popup (Fix 1.16); pages are
  // created from the chosen preset.
  const openCreateCanvas = useCallback(() => setCreateCanvasOpen(true), []);

  const createPageFromChoice = useCallback(
    (choice: CanvasChoice) => {
      const d = docRef.current;
      const base = choice.w === null ? 'Blank Canvas' : choice.label;
      // "A4 Portrait 1", "Instagram Post 2", … — next free number for the base.
      let n = 1;
      const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
      for (const p of d.pages) {
        const m = re.exec(p.name);
        if (m) n = Math.max(n, Number(m[1]) + 1);
      }
      // Every preset canvas is created as an infinite page holding one real,
      // selectable frame of the preset size — so the "artboard" can be
      // selected, moved, renamed, duplicated, and exported like any frame
      // (Fix 1.18 follow-up). "Blank Infinite Canvas" stays frameless.
      const name = `${base} ${n}`;
      const page: Page = {
        ...(choice.w === null ? newInfinitePage(0, name) : newPage(0)),
        name,
        canvasPreset: choice.presetId,
        canvasType: 'infinite' as const,
        width: null,
        height: null,
      };
      if (choice.w !== null) {
        page.orientation = (choice.h ?? 0) >= choice.w ? 'portrait' : 'landscape';
        page.elements = [mainFrame(choice.w, choice.h ?? choice.w, name)];
      }
      setDoc({ ...d, pages: [...d.pages, page], currentPage: d.pages.length }, true);
      setSelection([]);
      setCreateCanvasOpen(false);
    },
    [setDoc]
  );

  const selectPage = useCallback(
    (index: number) => {
      const d = docRef.current;
      if (index === d.currentPage) return;
      setDoc({ ...d, currentPage: index }, false);
      setSelection([]);
    },
    [setDoc]
  );

  const deletePage = useCallback(
    (index: number) => {
      const d = docRef.current;
      const page = d.pages[index];
      const hasContent = page.elements.length > 0;
      if (
        hasContent &&
        !window.confirm(`Delete "${page.name}" and its ${page.elements.length} object(s)? You can undo this.`)
      ) {
        return;
      }
      let pages = d.pages.filter((_, i) => i !== index);
      if (pages.length === 0) pages = [newInfinitePage(1)];
      const currentPage = Math.min(d.currentPage > index ? d.currentPage - 1 : d.currentPage, pages.length - 1);
      setDoc({ ...d, pages, currentPage }, true);
      setSelection([]);
    },
    [setDoc]
  );

  const duplicatePage = useCallback(
    (index: number) => {
      const d = docRef.current;
      const src = d.pages[index];
      const copy = {
        ...newPage(0, src.orientation),
        name: `${src.name} copy`,
        elements: cloneElements(src.elements, 0, 0),
      };
      const pages = [...d.pages.slice(0, index + 1), copy, ...d.pages.slice(index + 1)];
      setDoc({ ...d, pages, currentPage: index + 1 }, true);
      setSelection([]);
    },
    [setDoc]
  );

  const reorderPage = useCallback(
    (from: number, to: number) => {
      const d = docRef.current;
      const pages = [...d.pages];
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      const currentId = d.pages[d.currentPage].id;
      setDoc({ ...d, pages, currentPage: pages.findIndex((p) => p.id === currentId) }, true);
    },
    [setDoc]
  );

  const renamePage = useCallback(
    (index: number, name: string) => {
      const d = docRef.current;
      const pages = d.pages.map((p, i) => (i === index ? { ...p, name } : p));
      setDoc({ ...d, pages }, true);
    },
    [setDoc]
  );

  const toggleOrientation = useCallback(() => {
    const d = docRef.current;
    const cur = d.pages[d.currentPage];
    if (cur.canvasType === 'infinite') {
      // Frame-based pages: rotate the selected frame (or the first one) by
      // swapping its dimensions (Fix 1.19).
      const target =
        cur.elements.find((e) => selectionRef.current.includes(e.id) && e.type === 'frame') ??
        cur.elements.find((e) => e.type === 'frame');
      if (!target || target.locked) return;
      updateElements(
        cur.elements.map((e) => (e.id === target.id ? { ...e, width: e.height, height: e.width } : e)),
        true
      );
      return;
    }
    const pages = d.pages.map((p, i) => {
      if (i !== d.currentPage) return p;
      if (p.width && p.height) {
        // Custom-size pages rotate by swapping dimensions.
        return {
          ...p,
          width: p.height,
          height: p.width,
          orientation: p.width >= p.height ? ('portrait' as const) : ('landscape' as const),
        };
      }
      return { ...p, orientation: p.orientation === 'portrait' ? ('landscape' as const) : ('portrait' as const) };
    });
    setDoc({ ...d, pages }, true);
  }, [setDoc, updateElements]);

  /* -------------------------------- object actions ---------------------------- */

  const deleteSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.length === 0) return;
    const els = currentElements();
    // Deleting a frame deletes its contents too, after confirmation.
    const expanded = withFrameContents(els, sel);
    const carried = expanded.size - sel.length;
    if (sel.some((id) => els.find((e) => e.id === id)?.type === 'frame') && carried > 0) {
      if (!window.confirm(`Delete frame and all contents? (${carried} object${carried > 1 ? 's' : ''} inside)`)) {
        return;
      }
    }
    const removable = new Set(
      els.filter((e) => expanded.has(e.id) && !e.locked).map((e) => e.id)
    );
    if (removable.size === 0) return;
    updateElements(removeElements(els, removable), true);
    setSelection([]);
  }, [updateElements]);

  const duplicateSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.length === 0) return;
    const els = currentElements();
    const ids = withFrameContents(els, sel);
    const source = els.filter((e) => ids.has(e.id));
    // Duplicating a single frame: place the copy beside the original with
    // a 100px gap and an auto-incremented name (Fix 1.17).
    const onlyFrame = sel.length === 1 ? els.find((e) => e.id === sel[0] && e.type === 'frame') : undefined;
    if (onlyFrame) {
      const fb = getBounds(onlyFrame);
      const [nx, ny] = freeFramePosition(els, fb, fb.w, fb.h);
      let clones = cloneElements(source, nx - fb.x, ny - fb.y);
      const names = els.filter((e) => e.type === 'frame').map((e) => e.label ?? '');
      clones = clones.map((c) =>
        c.type === 'frame' ? { ...c, label: nextName(onlyFrame.label ?? 'Frame', names) } : c
      );
      updateElements([...els, ...clones], true);
      const frameClone = clones.find((c) => c.type === 'frame');
      setSelection(frameClone ? [frameClone.id] : clones.map((c) => c.id));
      return;
    }
    const clones = cloneElements(source, 16, 16);
    updateElements([...els, ...clones], true);
    setSelection(clones.map((c) => c.id));
  }, [updateElements]);

  const copySelection = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.length === 0) return false;
    clipboardRef.current = JSON.parse(
      JSON.stringify(currentElements().filter((e) => sel.includes(e.id)))
    );
    return true;
  }, []);

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const els = currentElements();
    const clones = cloneElements(clipboardRef.current, 16, 16);
    updateElements([...els, ...clones], true);
    setSelection(clones.map((c) => c.id));
    setToolState('select');
  }, [updateElements]);

  const toggleLock = useCallback(() => {
    const sel = new Set(selectionRef.current);
    const els = currentElements();
    const anyLocked = els.some((e) => sel.has(e.id) && e.locked);
    updateElements(
      els.map((e) => (sel.has(e.id) ? { ...e, locked: !anyLocked } : e)),
      true
    );
  }, [updateElements]);

  const groupSelection = useCallback(() => {
    const sel = new Set(selectionRef.current);
    if (sel.size < 2) return;
    const gid = uid();
    updateElements(
      currentElements().map((e) => (sel.has(e.id) ? { ...e, groupId: gid } : e)),
      true
    );
  }, [updateElements]);

  const ungroupSelection = useCallback(() => {
    const sel = new Set(selectionRef.current);
    updateElements(
      currentElements().map((e) => (sel.has(e.id) ? { ...e, groupId: null } : e)),
      true
    );
  }, [updateElements]);

  const zOrder = useCallback(
    (action: ZAction) => {
      updateElements(reorderElements(currentElements(), new Set(selectionRef.current), action), true);
    },
    [updateElements]
  );

  const align = useCallback(
    (action: AlignAction) => {
      const next = alignElements(currentElements(), new Set(selectionRef.current), action);
      updateElements(updateBoundArrows(next), true);
    },
    [updateElements]
  );

  const distribute = useCallback(
    (action: DistributeAction) => {
      const next = distributeElements(currentElements(), new Set(selectionRef.current), action);
      updateElements(updateBoundArrows(next), true);
    },
    [updateElements]
  );

  const resizeDimensions = useCallback(
    (dimensions: { width?: number; height?: number }, commit = true) => {
      if (!commit) startGesture();
      const next = resizeSelectionDimensions(currentElements(), new Set(selectionRef.current), dimensions);
      updateElements(updateBoundArrows(next), commit && gestureBaseRef.current === null);
    },
    [updateElements, startGesture]
  );

  const setLink = useCallback(
    (url: string | null) => {
      const sel = new Set(selectionRef.current);
      if (sel.size === 0) return;
      updateElements(
        currentElements().map((e) => (sel.has(e.id) && !e.locked ? { ...e, link: url ?? undefined } : e)),
        true
      );
      showToast(url ? 'Link attached — click the ↗ badge to open it' : 'Link removed');
    },
    [updateElements, showToast]
  );

  const setFrameName = useCallback(
    (id: string, name: string) => {
      updateElements(
        currentElements().map((e) => (e.id === id ? { ...e, label: name } : e)),
        true
      );
    },
    [updateElements]
  );

  const exportSelectedFrame = useCallback(
    (format: 'png' | 'svg' | 'pdf') => {
      const d = docRef.current;
      const page = d.pages[d.currentPage];
      const frame = page.elements.find(
        (e) => e.id === selectionRef.current[0] && e.type === 'frame'
      );
      if (!frame) return;
      runExport(
        () => exportFrame(d.title, page, frame, format),
        `Frame exported as ${format.toUpperCase()}`
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const exportPage = useCallback(
    (index: number, format: 'png' | 'svg' | 'pdf') => {
      runExport(
        () => exportPageAs(docRef.current, index, format),
        `Page exported as ${format.toUpperCase()}`
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Swap the selected frame's dimensions, keeping it centered (Fix 1.21). */
  const setFrameOrientation = useCallback(
    (orientation: 'portrait' | 'landscape') => {
      const sel = selectionRef.current;
      if (sel.length !== 1) return;
      updateElements(
        currentElements().map((e) => {
          if (e.id !== sel[0] || e.type !== 'frame' || e.locked) return e;
          const isPortrait = e.height >= e.width;
          if ((orientation === 'portrait') === isPortrait) return e;
          const cx = e.x + e.width / 2;
          const cy = e.y + e.height / 2;
          return { ...e, width: e.height, height: e.width, x: cx - e.height / 2, y: cy - e.width / 2 };
        }),
        true
      );
    },
    [updateElements]
  );

  const frameMenuAction = useCallback(
    (action: 'duplicate' | 'delete' | 'export-png' | 'export-pdf' | 'forward' | 'backward' | 'lock') => {
      switch (action) {
        case 'duplicate':
          duplicateSelection();
          break;
        case 'delete':
          deleteSelection();
          break;
        case 'export-png':
          exportSelectedFrame('png');
          break;
        case 'export-pdf':
          exportSelectedFrame('pdf');
          break;
        case 'forward':
          zOrder('forward');
          break;
        case 'backward':
          zOrder('backward');
          break;
        case 'lock':
          toggleLock();
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Step font size of every text-bearing selected element by ±1px (Fix 1.23). */
  const stepFontSize = useCallback(
    (delta: number) => {
      const sel = new Set(selectionRef.current);
      if (sel.size === 0) return false;
      let touched = false;
      const els = currentElements().map((e) => {
        if (!sel.has(e.id) || e.locked) return e;
        const isText = e.type === 'text';
        const hasContained = !!e.text && (e.type === 'sticky' || isTextContainer(e));
        if (!isText && !hasContained) return e;
        const base = e.fontSize ?? (isText ? 20 : 16);
        const fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(base + delta)));
        if (fontSize === base) return e;
        touched = true;
        const next = { ...e, fontSize };
        if (isText && e.boxed) {
          next.height = hugBoxedTextHeight(next);
          return next;
        }
        if (isText) {
          const m = measureText(next.text ?? '', fontSize);
          next.width = m.w;
          next.height = m.h;
          return next;
        }
        return ensureTextFits(next);
      });
      if (!touched) return false;
      updateElements(updateBoundArrows(els), true);
      return true;
    },
    [updateElements]
  );

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      // Frames carry their contents when nudged, same as dragging.
      const sel = withFrameContents(currentElements(), selectionRef.current);
      if (sel.size === 0) return false;
      let els = currentElements().map((e) =>
        sel.has(e.id) && !e.locked ? { ...e, x: e.x + dx, y: e.y + dy } : e
      );
      updateElements(updateBoundArrows(els), true);
      return true;
    },
    [updateElements]
  );

  const applyStylePatch = useCallback(
    (patch: StylePatch, commit: boolean) => {
      setDefaults((d) => ({ ...d, ...patch }));
      const sel = new Set(selectionRef.current);
      if (sel.size === 0) return;
      if (!commit) startGesture(); // idempotent: opens once per slider/picker drag
      const els = currentElements().map((e) => {
        if (!sel.has(e.id) || e.locked) return e;
        // Lines, arrows, and pencil strokes must keep a visible stroke.
        const isLinear = e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw';
        if (patch.strokeColor === 'transparent' && isLinear) return e;
        const next = { ...e, ...patch };
        if (patch.rotation !== undefined && e.points) {
          // Linear elements bake rotation into points; the angle input skips them.
          next.rotation = e.rotation;
        }
        const hasContainedText = !!next.text && (next.type === 'sticky' || isTextContainer(next));
        if (patch.textColor) {
          // Manual text color choice disables auto contrast (Fix 1.5 §3).
          next.autoTextContrast = false;
        }
        if (patch.autoTextContrast === true && hasContainedText) {
          next.textColor = contrastTextColor(next.fillColor);
        }
        if (patch.fillColor && hasContainedText && next.autoTextContrast !== false) {
          next.textColor = contrastTextColor(patch.fillColor);
        }
        if (patch.fontSize) {
          if (e.type === 'text' && e.boxed) {
            // Text boxes keep their width; height hugs the rewrapped content.
            next.height = hugBoxedTextHeight(next);
            return next;
          } else if (e.type === 'text') {
            const m = measureText(next.text ?? '', patch.fontSize);
            next.width = m.w;
            next.height = m.h;
          }
        }
        if ((patch.fontSize || patch.textAlign) && isTextContainer(next) && next.text) {
          return ensureTextFits(next);
        }
        return next;
      });
      // Never double-record: if a live gesture is open, endGesture() records it.
      updateElements(updateBoundArrows(els), commit && gestureBaseRef.current === null);
    },
    [updateElements, startGesture]
  );

  const applyStyle = useCallback((patch: StylePatch) => applyStylePatch(patch, true), [applyStylePatch]);
  const applyStyleLive = useCallback((patch: StylePatch) => applyStylePatch(patch, false), [applyStylePatch]);

  /* --------------------------------- image insert ----------------------------- */

  const insertImageFiles = useCallback(
    async (files: File[], at: Point | null) => {
      const d = docRef.current;
      const page = d.pages[d.currentPage];
      const { w: pw, h: ph } = pageSize(page);
      const added: SketchElement[] = [];
      for (const file of files) {
        try {
          const img = await fileToImageData(file);
          const maxW = pw * 0.6;
          const maxH = ph * 0.6;
          const scale = Math.min(1, maxW / img.width, maxH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const cx = at ? at[0] : pw / 2;
          const cy = at ? at[1] : ph / 2;
          const offset = added.length * 20;
          added.push({
            id: uid(),
            type: 'image',
            x: cx - w / 2 + offset,
            y: cy - h / 2 + offset,
            width: w,
            height: h,
            strokeColor: defaults.strokeColor,
            fillColor: 'transparent',
            strokeWidth: 1,
            strokeStyle: 'solid',
            opacity: 100,
            seed: Math.floor(Math.random() * 2 ** 31),
            locked: false,
            groupId: null,
            imageData: img.dataURL,
          });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Could not insert that image.');
        }
      }
      if (added.length > 0) {
        updateElements([...currentElements(), ...added], true);
        setSelection(added.map((a) => a.id));
        setToolState('select');
      }
    },
    [defaults.strokeColor, showToast, updateElements]
  );

  const setTool = useCallback(
    (t: Tool) => {
      if (t === 'image') {
        prevToolRef.current = tool;
        imageInputRef.current?.click();
        return;
      }
      setToolState(t);
    },
    [tool]
  );

  /* --------------------------------- file actions ----------------------------- */

  const newDocument = useCallback(() => {
    if (
      !docIsEmpty(docRef.current) &&
      !window.confirm(
        'Start a new document? Your current document will be discarded (it is not exported anywhere). Consider exporting a JSON backup first.'
      )
    ) {
      return;
    }
    const fresh = newDoc();
    undoRef.current = [];
    redoRef.current = [];
    docRef.current = fresh;
    setDocState(fresh);
    setSelection([]);
    saveSession(fresh).catch(() => undefined);
    setHistoryTick((t) => t + 1);
  }, []);

  const clearPage = useCallback(() => {
    const d = docRef.current;
    const page = d.pages[d.currentPage];
    if (page.elements.length === 0) return;
    if (!window.confirm(`Clear all ${page.elements.length} object(s) from "${page.name}"? You can undo this.`)) {
      return;
    }
    updateElements([], true);
    setSelection([]);
  }, [updateElements]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const imported = await importJSON(file);
        if (
          !docIsEmpty(docRef.current) &&
          !window.confirm('Replace the current document with the imported project?')
        ) {
          return;
        }
        undoRef.current = [];
        redoRef.current = [];
        docRef.current = imported;
        setDocState(imported);
        setSelection([]);
        saveSession(imported).catch(() => undefined);
        setHistoryTick((t) => t + 1);
        showToast(`Imported "${imported.title}" (${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''})`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Import failed.');
      }
    },
    [showToast]
  );

  const runExport = useCallback(
    async (fn: () => Promise<void> | void, successMsg: string) => {
      setExporting(true);
      try {
        await fn();
        showToast(successMsg);
      } catch (err) {
        showToast(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.');
      } finally {
        setExporting(false);
      }
    },
    [showToast]
  );

  /* ------------------------------ keyboard shortcuts --------------------------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Sliders keep focus after use; let arrow keys adjust them but hand
      // every other key back to the app so tool shortcuts keep working.
      const isRange = target instanceof HTMLInputElement && target.type === 'range';
      if (isRange && e.key.startsWith('Arrow')) return;
      if ((target.tagName === 'INPUT' && !isRange) || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const bracketLeft = e.key === '[' || e.code === 'BracketLeft';
      const bracketRight = e.key === ']' || e.code === 'BracketRight';

      if (mod && key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'c') {
        copySelection();
        return;
      }
      if (mod && key === 'x') {
        if (copySelection()) deleteSelection();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        setSelection(currentElements().filter((el) => !el.locked).map((el) => el.id));
        setToolState('select');
        return;
      }
      if (mod && key === 'g') {
        e.preventDefault();
        e.shiftKey ? ungroupSelection() : groupSelection();
        return;
      }
      if (mod && e.shiftKey && key === 'l') {
        e.preventDefault();
        toggleLock();
        return;
      }
      if (mod && e.shiftKey && (e.key === '>' || e.code === 'Period')) {
        e.preventDefault();
        stepFontSize(1);
        return;
      }
      if (mod && e.shiftKey && (e.key === '<' || e.code === 'Comma')) {
        e.preventDefault();
        stepFontSize(-1);
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        canvasRef.current?.zoomBy(1.2);
        return;
      }
      if (mod && key === '-') {
        e.preventDefault();
        canvasRef.current?.zoomBy(1 / 1.2);
        return;
      }
      if (mod && key === '0') {
        e.preventDefault();
        canvasRef.current?.fit();
        return;
      }
      if (mod && bracketRight) {
        e.preventDefault();
        e.stopPropagation();
        zOrder('forward');
        return;
      }
      if (mod && bracketLeft) {
        e.preventDefault();
        e.stopPropagation();
        zOrder('backward');
        return;
      }
      if (mod) return;

      if (bracketRight) {
        e.preventDefault();
        zOrder('front');
        return;
      }
      if (bracketLeft) {
        e.preventDefault();
        zOrder('back');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        setSelection([]);
        setToolState('select');
        setHelpOpen(false);
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1;
        const moved = nudgeSelection(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        );
        if (moved) e.preventDefault();
        return;
      }
      if (e.key === '?') {
        setHelpOpen((h) => !h);
        return;
      }
      if (e.key === '!') {
        canvasRef.current?.fit();
        return;
      }
      const t = TOOL_KEYS[key];
      if (t && !e.altKey) {
        setTool(t);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    undo,
    redo,
    copySelection,
    deleteSelection,
    duplicateSelection,
    groupSelection,
    ungroupSelection,
    toggleLock,
    nudgeSelection,
    stepFontSize,
    zOrder,
    setTool,
  ]);

  // OS clipboard paste: images take priority, then internal element clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        insertImageFiles(files, null);
        return;
      }
      if (clipboardRef.current.length > 0) {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertImageFiles, pasteClipboard]);

  /* ----------------------------------- render --------------------------------- */

  const page = doc.pages[doc.currentPage];

  return (
    <div className="app">
      <Toolbar
        title={doc.title}
        onTitleChange={(t) => setDoc({ ...docRef.current, title: t }, false)}
        onNew={newDocument}
        onImport={() => importInputRef.current?.click()}
        onExportPDF={() => runExport(() => exportPDF(docRef.current), 'PDF exported')}
        onExportPNGs={() => runExport(() => exportPNGs(docRef.current), 'PNG files exported')}
        onExportPNGBundle={() => runExport(() => exportPNGBundle(docRef.current), 'PNG bundle exported')}
        onExportSVGs={() => runExport(() => exportSVGs(docRef.current), 'SVG files exported')}
        onExportFramesPDF={() =>
          runExport(() => exportFramesPDF(docRef.current), 'Frames exported as PDF')
        }
        onExportJSON={() => runExport(() => exportJSON(docRef.current), 'Project file exported')}
        onClearPage={clearPage}
        exporting={exporting}
        onHelp={() => setHelpOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />

      <div className="main">
        <PagePanel
          doc={doc}
          collapsed={pagesCollapsed}
          onToggleCollapsed={() => setPagesCollapsed((c) => !c)}
          onSelectPage={selectPage}
          onAddPage={openCreateCanvas}
          onDeletePage={deletePage}
          onDuplicatePage={duplicatePage}
          onExportPage={exportPage}
          onReorderPage={reorderPage}
          onRenamePage={renamePage}
        />
        <div className="canvas-wrap">
          <CanvasArea
            ref={canvasRef}
            doc={doc}
            getDoc={getDoc}
            selection={selection}
            setSelection={setSelection}
            tool={tool}
            setTool={setToolState}
            defaults={defaults}
            updateElements={updateElements}
            startGesture={startGesture}
            endGesture={endGesture}
            onZoomChange={setZoom}
            onInsertImageFiles={insertImageFiles}
            onAddPage={openCreateCanvas}
            onFrameMenuAction={frameMenuAction}
            ratioLocked={ratioLocked}
          />
          <div className="floating-bottom">
            <ToolPanel tool={tool} setTool={setTool} />
            <div className="zoom-pill" aria-label="Zoom controls">
              <button className="icon-btn" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)} title="Zoom out (Ctrl/Cmd+-)">
                {Icons.zoomOut}
              </button>
              <button
                className="zoom-value"
                onClick={() => canvasRef.current?.fit()}
                title="Fit page to screen (Ctrl/Cmd+0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button className="icon-btn" onClick={() => canvasRef.current?.zoomBy(1.2)} title="Zoom in (Ctrl/Cmd+=)">
                {Icons.zoomIn}
              </button>
              <button className="icon-btn" onClick={() => canvasRef.current?.fit()} title="Fit page to screen">
                {Icons.fit}
              </button>
            </div>
          </div>
        </div>
        <PropertiesPanel
          selected={selectedElements}
          defaults={defaults}
          tool={tool}
          onStyle={applyStyle}
          onStyleLive={applyStyleLive}
          onStyleEnd={endGesture}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
          onToggleLock={toggleLock}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          onZOrder={zOrder}
          onAlign={align}
          onDistribute={distribute}
          onResizeDimensions={resizeDimensions}
          onResizeDimensionsEnd={endGesture}
          ratioLocked={ratioLocked}
          onToggleRatioLock={() => setRatioLocked((v) => !v)}
          onSetLink={setLink}
          onSetFrameName={setFrameName}
          onExportFrame={exportSelectedFrame}
          onSetFrameOrientation={setFrameOrientation}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}

      {onboarding && (
        <div className="onboarding">
          <div>
            <strong>Welcome to Sketchboard.</strong> Pick a tool from the bottom and draw on the white A4
            page. Add pages with the <b>+</b> button, and everything autosaves in your browser —
            no account needed. Press <b>?</b> anytime for shortcuts.
          </div>
          <button
            className="toolbar-btn"
            onClick={() => {
              localStorage.setItem(ONBOARD_KEY, '1');
              setOnboarding(false);
            }}
          >
            Got it
          </button>
        </div>
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

      {createCanvasOpen && (
        <CreateCanvasModal onCreate={createPageFromChoice} onClose={() => setCreateCanvasOpen(false)} />
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) insertImageFiles(files, null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const shortcuts: [string, string][] = [
    ['V / 1', 'Select'],
    ['R / 2', 'Rectangle'],
    ['O / 3', 'Ellipse'],
    ['D / 4', 'Diamond'],
    ['L / 5', 'Line'],
    ['A / 6', 'Arrow'],
    ['P / 7', 'Pencil'],
    ['T / 8', 'Text'],
    ['N / 9', 'Sticky note'],
    ['I', 'Insert image'],
    ['E / 0', 'Eraser'],
    ['K', 'Laser pointer'],
    ['F', 'Frame (artboard) tool'],
    ['More tools menu', 'Web embed, laser, lasso'],
    ['Ctrl/Cmd + Z', 'Undo'],
    ['Ctrl/Cmd + Shift + Z', 'Redo'],
    ['Ctrl/Cmd + C / V / X', 'Copy / paste / cut'],
    ['Ctrl/Cmd + Shift + > / <', 'Increase / decrease font size'],
    ['Ctrl/Cmd + D', 'Duplicate'],
    ['Alt + drag', 'Duplicate by dragging'],
    ['Ctrl/Cmd + A', 'Select all on page'],
    ['Ctrl/Cmd + G', 'Group (Shift to ungroup)'],
    ['Ctrl/Cmd + Shift + L', 'Lock / unlock selection'],
    ['Ctrl/Cmd + ]', 'Bring forward'],
    ['Ctrl/Cmd + [', 'Send backward'],
    [']', 'Bring to front'],
    ['[', 'Send to back'],
    ['Delete / Backspace', 'Delete selection'],
    ['Arrow keys', 'Nudge (Shift = 10px)'],
    ['Space + drag / middle-drag', 'Pan'],
    ['Ctrl/Cmd + scroll', 'Zoom'],
    ['Ctrl/Cmd + 0', 'Fit page to screen'],
    ['Double-click shape', 'Type inside the shape'],
    ['Double-click canvas', 'Add text'],
    ['Text tool + drag', 'Draw a wrapping text box'],
    ['Double-click arrow', 'Add arrow label'],
    ['Escape', 'Deselect / close'],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Help &amp; shortcuts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </div>
        <p className="modal-tip">
          Draw arrows near a shape to <b>bind</b> them — bound arrows follow the shape when it moves.
          Everything autosaves locally in this browser; use <b>Export → Project file</b> to move work
          between devices. Content near the edge stays in place when you rotate a page; anything past
          the edge is clipped in exports but still selectable.
        </p>
        <div className="shortcut-grid">
          {shortcuts.map(([k, desc]) => (
            <div key={k} className="shortcut-row">
              <kbd>{k}</kbd>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
