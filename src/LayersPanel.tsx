import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
import { groupDescendantIds, isGroupElement } from './elementOps';
import type { SketchElement } from './types';

/**
 * Figma-like Layers panel (Layer Implementation): frames as collapsible
 * parents, their contents (topmost first), groups as nested parents, and a
 * "Canvas" section for elements outside every frame. Rows select, rename
 * (double-click), toggle visibility/lock, and drag-reorder within their
 * parent.
 */
interface Props {
  elements: SketchElement[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  onPatch: (id: string, patch: Partial<SketchElement>) => void;
  onReorder: (srcId: string, dstId: string, place: 'above' | 'below') => void;
}

const LAYER_ICONS: Record<string, keyof typeof Icons> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  line: 'line',
  arrow: 'arrow',
  freedraw: 'pencil',
  text: 'text',
  sticky: 'sticky',
  image: 'image',
  embed: 'embed',
  group: 'group',
  frame: 'frame',
};

export function layerNameOf(el: SketchElement): string {
  if (el.type === 'frame') return el.label || 'Frame';
  if (el.name) return el.name;
  const base = el.type === 'ellipse' ? 'Circle' : el.type === 'freedraw' ? 'Pencil' : el.type;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function LayersPanel({ elements, selection, onSelect, onPatch, onReorder }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  // Synchronous mirror: the first dragover can fire before React flushes
  // the dragstart state update.
  const dragIdRef = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; place: 'above' | 'below' } | null>(null);
  const lastClickRef = useRef<string | null>(null);

  const byId = new Map(elements.map((el) => [el.id, el]));
  const indexOf = new Map(elements.map((el, i) => [el.id, i]));

  // Everything that lives inside some group (any depth).
  const inGroup = new Set<string>();
  for (const el of elements) {
    if (isGroupElement(el)) for (const cid of el.childIds) inGroup.add(cid);
  }

  const frames = elements.filter((el) => el.type === 'frame').slice().reverse();
  const childrenOfFrame = (fid: string) =>
    elements
      .filter((el) => el.type !== 'frame' && el.frameId === fid && !inGroup.has(el.id))
      .slice()
      .reverse();
  const childrenOfGroup = (g: SketchElement) =>
    (g.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((el): el is SketchElement => !!el)
      .sort((a, b) => (indexOf.get(b.id) ?? 0) - (indexOf.get(a.id) ?? 0));
  const canvasChildren = elements
    .filter((el) => el.type !== 'frame' && !el.frameId && !inGroup.has(el.id))
    .slice()
    .reverse();

  // Parent key for reorder scoping: only same-parent drops are allowed.
  const parentKeyOf = (el: SketchElement): string => {
    for (const g of elements) {
      if (isGroupElement(g) && g.childIds.includes(el.id)) return `g:${g.id}`;
    }
    if (el.type === 'frame') return 'frames';
    return el.frameId ? `f:${el.frameId}` : 'canvas';
  };

  // Auto-expand ancestors of the primary selection so it is visible.
  useEffect(() => {
    if (selection.length === 0) return;
    const el = byId.get(selection[0]);
    if (!el) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (el.frameId) next.delete(el.frameId);
      for (const g of elements) {
        if (isGroupElement(g) && groupDescendantIds(elements, g.id).includes(el.id)) next.delete(g.id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join('|')]);

  const idsFor = (el: SketchElement): string[] =>
    isGroupElement(el) ? [el.id, ...groupDescendantIds(elements, el.id)] : [el.id];

  const clickRow = (el: SketchElement, e: React.MouseEvent, siblings: SketchElement[]) => {
    const ids = idsFor(el);
    if (e.metaKey || e.ctrlKey) {
      const cur = new Set(selection);
      const isSel = ids.every((id) => cur.has(id));
      for (const id of ids) {
        if (isSel) cur.delete(id);
        else cur.add(id);
      }
      onSelect([...cur]);
    } else if (e.shiftKey && lastClickRef.current) {
      const a = siblings.findIndex((s) => s.id === lastClickRef.current);
      const b = siblings.findIndex((s) => s.id === el.id);
      if (a >= 0 && b >= 0) {
        const range = siblings.slice(Math.min(a, b), Math.max(a, b) + 1);
        onSelect(range.flatMap((s) => idsFor(s)));
      } else {
        onSelect(ids);
      }
    } else {
      onSelect(ids);
    }
    lastClickRef.current = el.id;
  };

  const startRename = (el: SketchElement) => {
    setRenaming(el.id);
    setRenameValue(layerNameOf(el));
  };
  const commitRename = (el: SketchElement) => {
    const v = renameValue.trim();
    setRenaming(null);
    if (!v || v === layerNameOf(el)) return; // empty reverts
    onPatch(el.id, el.type === 'frame' ? { label: v } : { name: v });
  };

  const renderRow = (el: SketchElement, depth: number, siblings: SketchElement[]) => {
    const expandable = el.type === 'frame' || isGroupElement(el);
    const isCollapsed = collapsed.has(el.id);
    const selected = selection.includes(el.id);
    const hidden = el.visible === false;
    const icon = Icons[LAYER_ICONS[el.type] ?? 'rectangle'];
    const kids = el.type === 'frame' ? childrenOfFrame(el.id) : isGroupElement(el) ? childrenOfGroup(el) : [];

    return (
      <div key={el.id}>
        <div
          className={`layer-row ${selected ? 'selected' : ''} ${hidden ? 'layer-hidden' : ''} ${
            dropAt?.id === el.id ? `drop-${dropAt.place}` : ''
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            dragIdRef.current = el.id;
            setDragId(el.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            const dragging = dragIdRef.current;
            if (!dragging || dragging === el.id) return;
            const src = byId.get(dragging);
            if (!src || parentKeyOf(src) !== parentKeyOf(el)) return;
            // Dropping onto your own descendant is invalid.
            if (isGroupElement(src) && groupDescendantIds(elements, src.id).includes(el.id)) return;
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setDropAt({ id: el.id, place: e.clientY < r.top + r.height / 2 ? 'above' : 'below' });
          }}
          onDragLeave={() => setDropAt((d) => (d?.id === el.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            const dragging = dragIdRef.current;
            const src = dragging ? byId.get(dragging) : null;
            if (
              dragging &&
              dragging !== el.id &&
              src &&
              parentKeyOf(src) === parentKeyOf(el) &&
              !(isGroupElement(src) && groupDescendantIds(elements, src.id).includes(el.id))
            ) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onReorder(dragging, el.id, e.clientY < r.top + r.height / 2 ? 'above' : 'below');
            }
            dragIdRef.current = null;
            setDragId(null);
            setDropAt(null);
          }}
          onDragEnd={() => {
            dragIdRef.current = null;
            setDragId(null);
            setDropAt(null);
          }}
          onClick={(e) => clickRow(el, e, siblings)}
          onDoubleClick={() => startRename(el)}
        >
          {expandable ? (
            <button
              className="layer-chevron"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(el.id)) next.delete(el.id);
                  else next.add(el.id);
                  return next;
                });
              }}
            >
              {isCollapsed ? Icons.chevronRight : Icons.chevronDown}
            </button>
          ) : (
            <span className="layer-chevron-spacer" />
          )}
          <span className="layer-icon">{icon}</span>
          {renaming === el.id ? (
            <input
              className="layer-rename-input"
              value={renameValue}
              autoFocus
              spellCheck={false}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename(el);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => commitRename(el)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="layer-name" title={layerNameOf(el)}>
              {layerNameOf(el)}
            </span>
          )}
          <span className="layer-actions">
            <button
              className="icon-btn small"
              title={hidden ? 'Show' : 'Hide'}
              aria-label={hidden ? 'Show layer' : 'Hide layer'}
              onClick={(e) => {
                e.stopPropagation();
                onPatch(el.id, { visible: hidden ? true : false });
              }}
            >
              {hidden ? Icons.eyeOff : Icons.eye}
            </button>
            <button
              className="icon-btn small"
              title={el.locked ? 'Unlock' : 'Lock'}
              aria-label={el.locked ? 'Unlock layer' : 'Lock layer'}
              onClick={(e) => {
                e.stopPropagation();
                onPatch(el.id, { locked: !el.locked });
              }}
            >
              {el.locked ? Icons.lock : Icons.unlock}
            </button>
          </span>
        </div>
        {expandable && !isCollapsed && (
          <div>
            {kids.length === 0 && el.type === 'frame' ? (
              <div className="layer-empty" style={{ paddingLeft: 20 + depth * 14 }}>
                No layers inside this frame.
              </div>
            ) : (
              kids.map((k) => renderRow(k, depth + 1, kids))
            )}
          </div>
        )}
      </div>
    );
  };

  const isEmpty = frames.length === 0 && canvasChildren.length === 0;

  return (
    <div className="layers-panel" aria-label="Layers">
      <div className="layers-header">Layers</div>
      <div className="layers-scroll">
        {isEmpty && (
          <div className="layer-empty">
            No layers yet.
            <br />
            Create a frame or draw an object to see layers here.
          </div>
        )}
        {frames.map((f) => renderRow(f, 0, frames))}
        {canvasChildren.length > 0 && (
          <>
            <div className="layers-subheader">Canvas</div>
            {canvasChildren.map((el) => renderRow(el, 0, canvasChildren))}
          </>
        )}
      </div>
    </div>
  );
}
