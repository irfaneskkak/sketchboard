import { boundsUnion, getAABB, getBounds } from './geometry';
import { randomSeed, uid } from './types';
import type { Point, SketchElement } from './types';

export function isGroupElement(el: SketchElement | undefined | null): el is SketchElement & { type: 'group'; childIds: string[] } {
  return !!el && el.type === 'group' && Array.isArray(el.childIds);
}

export function isGroupableElement(el: SketchElement | undefined | null): el is SketchElement {
  return !!el && el.type !== 'frame';
}

export function elementMap(elements: SketchElement[]): Map<string, SketchElement> {
  return new Map(elements.map((el) => [el.id, el]));
}

export function groupParentMap(elements: SketchElement[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of elements) {
    if (isGroupElement(el)) {
      for (const childId of el.childIds) out.set(childId, el.id);
    }
    if (el.groupId) out.set(el.id, el.groupId);
  }
  return out;
}

export function groupDescendantIds(elements: SketchElement[], groupId: string): string[] {
  const byId = elementMap(elements);
  const out: string[] = [];
  const walk = (id: string) => {
    const group = byId.get(id);
    if (!isGroupElement(group)) return;
    for (const childId of group.childIds) {
      if (out.includes(childId)) continue;
      out.push(childId);
      walk(childId);
    }
  };
  walk(groupId);
  return out;
}

export function groupAncestorIds(elements: SketchElement[], id: string): string[] {
  const parentById = groupParentMap(elements);
  const out: string[] = [];
  let cur = parentById.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = parentById.get(cur);
  }
  return out;
}

export function selectedGroupRoots(elements: SketchElement[], ids: Set<string>): SketchElement[] {
  const byId = elementMap(elements);
  return elements.filter((el) => {
    if (!ids.has(el.id) || !isGroupableElement(el)) return false;
    return !groupAncestorIds(elements, el.id).some((ancestorId) => ids.has(ancestorId) && byId.has(ancestorId));
  });
}

/* ----------------------------------- frames ---------------------------------- */

/** Is the element's center inside the frame's bounds? */
export function centerInFrame(el: SketchElement, frame: SketchElement): boolean {
  const fb = getBounds(frame);
  const b = getAABB(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= fb.x && cx <= fb.x + fb.w && cy >= fb.y && cy <= fb.y + fb.h;
}

/**
 * Expand a set of ids so frames carry their contents. Membership is the
 * element's stored frameId (Fix 1.39) — set by pointer position while
 * dragging, not by geometric overlap.
 */
export function withFrameContents(elements: SketchElement[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of elements) {
      if (out.has(el.id) || !el.frameId || !out.has(el.frameId)) continue;
      out.add(el.id);
      changed = true;
    }
  }
  return out;
}

/** "Login Screen" → "Login Screen 2"; "Mobile Screen 1" → "Mobile Screen 2". */
export function nextName(base: string, existing: string[]): string {
  const stripped = base.replace(/ \d+$/, '') || base;
  const re = new RegExp(`^${stripped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
  let n = 1;
  for (const name of existing) {
    const m = re.exec(name);
    if (m) n = Math.max(n, (m[1] ? Number(m[1]) : 1) + 1);
  }
  return `${stripped} ${n}`;
}

/**
 * A free spot for a new/duplicated frame: to the right of `near` with a
 * 100px gap, else below, else keep stepping right (Fix 1.17 §6).
 */
export function freeFramePosition(
  elements: SketchElement[],
  near: { x: number; y: number; w: number; h: number },
  w: number,
  h: number
): Point {
  const frames = elements.filter((el) => el.type === 'frame');
  const overlaps = (x: number, y: number) =>
    frames.some((f) => {
      const fb = getBounds(f);
      return x < fb.x + fb.w + 40 && x + w > fb.x - 40 && y < fb.y + fb.h + 40 && y + h > fb.y - 40;
    });
  const GAP = 100;
  let x = near.x + near.w + GAP;
  let y = near.y;
  if (!overlaps(x, y)) return [x, y];
  // below the original
  if (!overlaps(near.x, near.y + near.h + GAP + 20)) return [near.x, near.y + near.h + GAP + 20];
  // keep stepping right until free
  for (let i = 0; i < 50; i++) {
    x += w + GAP;
    if (!overlaps(x, y)) return [x, y];
  }
  return [x, y];
}

/** Remove elements and strip any arrow bindings that pointed at them. */
export function removeElements(elements: SketchElement[], ids: Set<string>): SketchElement[] {
  return elements
    .filter((el) => !ids.has(el.id))
    .map((el) => {
      const dropStart = el.startBinding && ids.has(el.startBinding);
      const dropEnd = el.endBinding && ids.has(el.endBinding);
      const nextChildIds = el.childIds?.filter((childId) => !ids.has(childId));
      const childIdsChanged = !!el.childIds && nextChildIds!.length !== el.childIds.length;
      if (!dropStart && !dropEnd && !childIdsChanged) return el;
      return {
        ...el,
        startBinding: dropStart ? null : el.startBinding,
        endBinding: dropEnd ? null : el.endBinding,
        childIds: childIdsChanged ? nextChildIds : el.childIds,
      };
    });
}

/** Deep-clone elements with fresh ids/seeds/groups, offset by (dx, dy). */
export function cloneElements(source: SketchElement[], dx: number, dy: number): SketchElement[] {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of source) idMap.set(el.id, uid());
  return source.map((el) => {
    const copy: SketchElement = JSON.parse(JSON.stringify(el));
    copy.id = idMap.get(el.id)!;
    copy.seed = randomSeed();
    copy.x += dx;
    copy.y += dy;
    if (copy.childIds) copy.childIds = copy.childIds.filter((id) => idMap.has(id)).map((id) => idMap.get(id)!);
    if (copy.groupId) {
      if (idMap.has(copy.groupId)) {
        copy.groupId = idMap.get(copy.groupId)!;
      } else {
        if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, uid());
        copy.groupId = groupMap.get(copy.groupId)!;
      }
    }
    copy.startBinding = copy.startBinding && idMap.has(copy.startBinding) ? idMap.get(copy.startBinding)! : null;
    copy.endBinding = copy.endBinding && idMap.has(copy.endBinding) ? idMap.get(copy.endBinding)! : null;
    if (copy.frameId && idMap.has(copy.frameId)) copy.frameId = idMap.get(copy.frameId)!;
    return copy;
  });
}

/** Expand a set of ids so whole groups are always selected together. */
export function expandWithGroups(elements: SketchElement[], ids: string[]): string[] {
  const byId = elementMap(elements);
  const parentById = groupParentMap(elements);
  const idSet = new Set(ids);

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...idSet]) {
      const parentId = parentById.get(id);
      if (parentId && !idSet.has(parentId)) {
        idSet.add(parentId);
        changed = true;
      }
      const el = byId.get(id);
      if (isGroupElement(el)) {
        for (const childId of el.childIds) {
          if (!idSet.has(childId)) {
            idSet.add(childId);
            changed = true;
          }
        }
      }
    }
  }
  return [...idSet];
}

export type ZAction = 'forward' | 'backward' | 'front' | 'back';

function reorderList<T extends { id: string }>(items: T[], ids: Set<string>, action: ZAction): T[] {
  const selected = items.filter((item) => ids.has(item.id));
  const rest = items.filter((item) => !ids.has(item.id));
  if (selected.length === 0) return items;
  switch (action) {
    case 'front':
      return [...rest, ...selected];
    case 'back':
      return [...selected, ...rest];
    case 'forward': {
      const out = [...items];
      for (let i = out.length - 2; i >= 0; i--) {
        if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) {
          [out[i], out[i + 1]] = [out[i + 1], out[i]];
        }
      }
      return out;
    }
    case 'backward': {
      const out = [...items];
      for (let i = 1; i < out.length; i++) {
        if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) {
          [out[i], out[i - 1]] = [out[i - 1], out[i]];
        }
      }
      return out;
    }
  }
}

function containingFrameId(el: SketchElement, elements: SketchElement[]): string | null {
  if (el.type === 'frame' || !el.frameId) return null;
  return elements.some((f) => f.id === el.frameId && f.type === 'frame') ? el.frameId : null;
}

export function reorderElements(elements: SketchElement[], ids: Set<string>, action: ZAction): SketchElement[] {
  if (ids.size === 0) return elements;

  const byId = new Map(elements.map((el) => [el.id, el]));
  const parentById = new Map<string, string | null>();
  for (const el of elements) parentById.set(el.id, containingFrameId(el, elements));

  const childrenByFrame = new Map<string, SketchElement[]>();
  for (const el of elements) {
    const frameId = parentById.get(el.id);
    if (!frameId) continue;
    if (!childrenByFrame.has(frameId)) childrenByFrame.set(frameId, []);
    childrenByFrame.get(frameId)!.push(el);
  }

  type Unit = { id: string; root: SketchElement; children: SketchElement[] };
  const units: Unit[] = [];
  const consumedChildren = new Set<string>();
  for (const el of elements) {
    const frameId = parentById.get(el.id);
    if (frameId) {
      consumedChildren.add(el.id);
      continue;
    }
    const children = el.type === 'frame' ? childrenByFrame.get(el.id) ?? [] : [];
    for (const child of children) consumedChildren.add(child.id);
    units.push({ id: el.id, root: el, children });
  }

  const topLevelIds = new Set<string>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el) continue;
    if (!parentById.get(id)) topLevelIds.add(id);
  }

  const orderedUnits = reorderList(units, topLevelIds, action);
  const out: SketchElement[] = [];
  for (const unit of orderedUnits) {
    out.push(unit.root);
    if (unit.root.type === 'frame') {
      out.push(...reorderList(unit.children, ids, action));
    }
  }

  // Preserve any orphaned entries defensively, though all elements should be
  // represented by either a top-level unit or a frame child.
  for (const el of elements) {
    if (!consumedChildren.has(el.id) && !out.some((item) => item.id === el.id)) out.push(el);
  }

  return out;
}

export type AlignAction = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAction = 'horizontal' | 'vertical';

type ElementUnit = {
  key: string;
  members: SketchElement[];
  bounds: ReturnType<typeof boundsUnion>;
};

function selectedUnits(elements: SketchElement[], ids: Set<string>): ElementUnit[] {
  const roots = selectedGroupRoots(elements, ids).filter((el) => !el.locked);
  const byId = elementMap(elements);
  const units = new Map<string, SketchElement[]>();
  for (const root of roots) {
    const key = root.id;
    const members = isGroupElement(root)
      ? groupDescendantIds(elements, root.id).map((id) => byId.get(id)).filter((el): el is SketchElement => !!el && el.type !== 'group')
      : [root];
    units.set(key, members.length > 0 ? members : [root]);
  }
  return [...units.entries()].map(([key, members]) => ({
    key,
    members,
    // Visual (rotation-aware) boxes: rotated objects align/distribute by
    // what the user sees (Fix 1.38 §13).
    bounds: boundsUnion(members.map(getAABB)),
  }));
}

/**
 * Align selected elements; grouped elements move as a single unit.
 * A single unit aligns to its parent frame's bounds (Fix 1.38); two or
 * more units align to the selection bounds.
 */
export function alignElements(elements: SketchElement[], ids: Set<string>, action: AlignAction): SketchElement[] {
  const units = selectedUnits(elements, ids);
  if (units.length === 0) return elements;
  const roots = selectedGroupRoots(elements, ids);

  let overall: ReturnType<typeof boundsUnion>;
  if (units.length === 1) {
    if (units[0].members.some((el) => el.type === 'frame')) return elements;
    const fid = units[0].members[0].frameId;
    const frame = fid ? elements.find((f) => f.id === fid && f.type === 'frame') : null;
    if (!frame) return elements;
    overall = getBounds(frame);
  } else {
    overall = boundsUnion(units.map((unit) => unit.bounds));
  }
  const shifts = new Map<string, Point>();
  for (const { key, bounds: b } of units) {
    let dx = 0;
    let dy = 0;
    switch (action) {
      case 'left':
        dx = overall.x - b.x;
        break;
      case 'centerX':
        dx = overall.x + overall.w / 2 - (b.x + b.w / 2);
        break;
      case 'right':
        dx = overall.x + overall.w - (b.x + b.w);
        break;
      case 'top':
        dy = overall.y - b.y;
        break;
      case 'centerY':
        dy = overall.y + overall.h / 2 - (b.y + b.h / 2);
        break;
      case 'bottom':
        dy = overall.y + overall.h - (b.y + b.h);
        break;
    }
    shifts.set(key, [dx, dy]);
  }
  return elements.map((el) => {
    const root = roots.find((candidate) => candidate.id === el.id || groupAncestorIds(elements, el.id).includes(candidate.id));
    const key = root?.id ?? el.id;
    if (el.type === 'group' || !ids.has(el.id) || el.locked || !shifts.has(key)) return el;
    const [dx, dy] = shifts.get(key)!;
    return { ...el, x: el.x + dx, y: el.y + dy };
  });
}

export function distributeElements(elements: SketchElement[], ids: Set<string>, action: DistributeAction): SketchElement[] {
  const units = selectedUnits(elements, ids);
  if (units.length < 3) return elements;
  const roots = selectedGroupRoots(elements, ids);

  const sorted = [...units].sort((a, b) =>
    action === 'horizontal'
      ? a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
      : a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x
  );
  const first = sorted[0].bounds;
  const last = sorted[sorted.length - 1].bounds;
  const span =
    action === 'horizontal'
      ? last.x + last.w - first.x
      : last.y + last.h - first.y;
  const totalSize = sorted.reduce(
    (sum, unit) => sum + (action === 'horizontal' ? unit.bounds.w : unit.bounds.h),
    0
  );
  const gap = (span - totalSize) / (sorted.length - 1);

  const shifts = new Map<string, Point>();
  let cursor = action === 'horizontal' ? first.x + first.w + gap : first.y + first.h + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const unit = sorted[i];
    if (action === 'horizontal') {
      shifts.set(unit.key, [cursor - unit.bounds.x, 0]);
      cursor += unit.bounds.w + gap;
    } else {
      shifts.set(unit.key, [0, cursor - unit.bounds.y]);
      cursor += unit.bounds.h + gap;
    }
  }

  return elements.map((el) => {
    const root = roots.find((candidate) => candidate.id === el.id || groupAncestorIds(elements, el.id).includes(candidate.id));
    const key = root?.id ?? el.id;
    if (el.type === 'group' || !ids.has(el.id) || el.locked || !shifts.has(key)) return el;
    const [dx, dy] = shifts.get(key)!;
    return { ...el, x: el.x + dx, y: el.y + dy };
  });
}

export interface ResizeDimensions {
  width?: number;
  height?: number;
}

export function selectionDimensions(elements: SketchElement[], ids: Set<string>): { width: number; height: number } | null {
  const selected = elements.filter((el) => ids.has(el.id));
  if (selected.length === 0) return null;
  const b = boundsUnion(selected.map(getBounds));
  return { width: b.w, height: b.h };
}

/** Resize selected elements from the selection center; multi-select and groups scale as one unit. */
export function resizeSelectionDimensions(
  elements: SketchElement[],
  ids: Set<string>,
  dimensions: ResizeDimensions
): SketchElement[] {
  const selected = elements.filter((el) => ids.has(el.id) && !el.locked);
  if (selected.length === 0) return elements;

  const b = boundsUnion(selected.map(getBounds));
  if (b.w <= 0 || b.h <= 0) return elements;

  const nextW = dimensions.width ?? b.w;
  const nextH = dimensions.height ?? b.h;
  if (!Number.isFinite(nextW) || !Number.isFinite(nextH) || nextW <= 0 || nextH <= 0) return elements;

  const sx = nextW / b.w;
  const sy = nextH / b.h;
  const originX = b.x + b.w / 2;
  const originY = b.y + b.h / 2;
  const tx = (x: number) => originX + (x - originX) * sx;
  const ty = (y: number) => originY + (y - originY) * sy;

  return elements.map((el) => {
    if (!ids.has(el.id) || el.locked) return el;
    if (el.points && el.points.length > 0) {
      const nextX = tx(el.x);
      const nextY = ty(el.y);
      return {
        ...el,
        x: nextX,
        y: nextY,
        width: Math.max(1, el.width * sx),
        height: Math.max(1, el.height * sy),
        points: el.points.map(([px, py]) => [px * sx, py * sy] as Point),
        controlPoint: el.controlPoint ? ([el.controlPoint[0] * sx, el.controlPoint[1] * sy] as Point) : el.controlPoint,
      };
    }
    const nextWidth = Math.max(1, el.width * sx);
    const nextHeight = Math.max(1, el.height * sy);
    return {
      ...el,
      x: tx(el.x + el.width / 2) - nextWidth / 2,
      y: ty(el.y + el.height / 2) - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      crop: el.crop
        ? { ...el.crop, x: el.crop.x * sx, y: el.crop.y * sy, w: el.crop.w * sx, h: el.crop.h * sy }
        : el.crop,
    };
  });
}
