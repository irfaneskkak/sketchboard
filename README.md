# Sketchboard

A fixed A4, multi-page drawing and annotation tool — a structured, page-based
alternative to infinite-canvas apps. Fully client-side: no backend, no login,
no AI. Implements `Project Notes/PRD_Sketchboard_A4_Canvas_v2.md`.

## Run

```bash
npm install
npm run dev       # dev server
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build
```

The `dist/` output is static files — host anywhere (or open via any static file
server). Note: npm scripts invoke binaries through `node` directly because this
workspace path contains `:` characters, which break `PATH` lookups.

## Features

- **Pages** — A4 (595×842 pt) white pages on a black desk. The Pages panel
  offers two view modes (Fix 1.13): a compact **list view** (default; page
  names with rounded active highlight) and an optional **thumbnail view**
  (aspect-correct, debounced live previews), toggled via list/grid icons in
  the header — the choice is remembered locally. The panel defaults to 320px
  and can be drag-resized between 300–420px (persisted; Fix 1.14); thumbnail
  cards (~240px) sit horizontally centered in a single column with 24px gaps
  at any panel width (Fix 1.15). Both views support select,
  rename (double-click or menu), duplicate, delete, and drag-reorder via a
  hover ⋯ menu. The + buttons open a **Create New Canvas** popup (Fix 1.16)
  with size presets — Paper (A4/A3), Presentation, Mobile, Tablet, Desktop,
  Social Media — plus a validated custom size (100–10000px) and a **Blank
  Infinite Canvas** (freeform, no page frame; exports crop to content).
  Pages are named from their preset ("Instagram Post 1", …) and store their
  canvas size; PDF export emits each page at its own dimensions. Per-page
  portrait/landscape toggle (swaps custom dimensions).
- **Tools** — select, rectangle, ellipse, diamond, line, arrow, pencil, text,
  sticky note, image insert (file picker, drag-drop, or OS paste), eraser
  (splits freehand strokes; deletes other objects — but never frames: it
  only erases a frame's contents). Tools live in a floating
  bottom-center toolbar with a zoom pill beside it (Fix 1.1).
- **Text** (Fix 1.2/1.7/1.35) — press `T`, click, and type: the caret blinks
  immediately at the click point and the box hugs the content live. The
  editor shows a clean **solid blue 1px outline** (never dashed — dashes are
  reserved for the drag-select marquee), the text-insertion cursor appears
  while the tool is active, and no resize/rotation handles are drawn during
  editing. The text tool clicks to place auto-width text or
  drags to draw a fixed-width text box that wraps and reflows on resize.
  Resizing *any* standalone text converts it to a fixed-width wrapping box
  (font size unchanged) — text can never overflow its bounding box. Text
  boxes hug their content Figma-style (Fix 1.8): the box grows live while
  typing, and the height both grows *and shrinks* to exactly fit the wrapped
  lines when the width changes. Each edit session is a single undo step. Double-click
  any rectangle/ellipse/diamond (or sticky) to type inside it: text is
  wrapped, padded (8/12/16px by shape size; 4px in text boxes), centered by
  default, and the shape auto-grows when text outgrows it. Words longer than
  the container break at character level, so text is never clipped
  horizontally (Fix 1.3); a single `layoutText` routine drives the canvas,
  the editor overlay, and SVG export. Escape, outside click, or picking
  another tool commits; cancelled empty text leaves nothing behind.
- **Crisp rendering** — clean solid fills and precise strokes (Figma-like);
  solid, dashed, and dotted stroke styles with visual previews.
- **Rulers** — top and left measurement rulers in page points, zoom- and
  pan-aware, with the page extent highlighted.
- **Arrowheads** — every arrow and line has an Arrowheads control (sidebar
  segmented buttons + right-click menu with the current mode checked):
  **None / Start / End / Both**. New arrows default to End, lines to None
  (setting heads on a line effectively converts it), the last explicit
  choice is remembered for newly drawn arrows, curved arrows aim heads
  along the true Bézier tangents at each end, and the right-click menu
  adds **Reverse direction** (swaps geometry and bindings). Heads scale
  with stroke width, match stroke color, and export to PNG/SVG/PDF.
- **Connectors** — arrows drawn near a shape bind to it and follow when the
  shape moves or resizes. Double-click an arrow to give it a label. Dragging an
  arrow endpoint re-binds it; dragging the arrow itself detaches it. Frames
  bind only at their border (an arrow drawn *inside* a frame stays free), and
  an arrow never binds both ends to the same element.
- **Context-aware right-click menus** — a plain right-click (no drag)
  opens a menu tailored to what's under the cursor: empty canvas (Paste,
  Select all, Add frame/text/image, Zoom), frames (rename, duplicate,
  export, add neighbors, lock, layer, delete), shapes, text (edit, font
  stepping), images (crop, fit/fill, reset), clipping masks (edit/release),
  lines/arrows (incl. Straighten), groups, multi-selections (group/ungroup,
  make-mask when exactly one image + one shape above it, align,
  distribute), locked objects (Unlock/Copy — locked elements stay
  recoverable), and crop-edit mode (exit/fit/fill/reset). Right-clicking
  an unselected object selects it first; empty-canvas clicks clear the
  selection. Arrow keys + Enter navigate, Escape closes, shortcut hints
  show on the right, and every item is a fallback for browser-blocked
  shortcuts. The menu is **viewport-fixed and never cut off**: it's
  measured after render and clamped inside the screen (16px margins, 40px
  bottom safe zone for the Dock), centers itself when taller than 80% of
  the viewport, scrolls internally on small screens, and locks body/canvas
  scrolling while open — wheel input can't zoom or pan the canvas behind
  it.
- **Right-click pan** (Fix 1.27) — press and hold the right mouse button
  anywhere on the canvas to pan, regardless of the active tool; the cursor
  shows grab/grabbing and the tool is untouched on release. A right-click
  *without* dragging (under a 4px threshold) still opens the frame context
  menu; the browser context menu is always suppressed. Spacebar-drag and
  middle-mouse pan are unchanged.
- **Styling** — compact Figma-style **Fill/Stroke rows** (Fix 1.24): color
  swatch (opens the advanced picker: hue + saturation/value wheel, HEX,
  recents), inline HEX field, per-paint opacity %, an eye toggle that hides
  a paint without losing its color, minus to remove and + to add; mixed
  selections show "Mixed". Opacity inputs step predictably from the
  keyboard (Opacity Value Change): Arrow ±1, Shift+Arrow ±10, clamped
  0–100 with custom handling (no inconsistent native number stepping) —
  the same for the object Opacity slider. New shapes default to solid `#D9D9D9` fill with
  no stroke, and a **Triangle** tool (`Y`) joins the toolbar with full shape
  behavior including contained text and a single internal corner-radius dot
  (drag to round all three corners evenly, live label, panel sync — Fix
  1.26). The sidebar is **context-aware** (Fix 1.26): sections render only
  when every selected element supports them (no Fill for lines/text, no
  stroke controls for text/images, etc.), tools show their own defaults,
  and an empty selection shows a minimal empty state. **Stroke width and
  stroke style appear only while a stroke is active** (Stroke width slide
  logic): removing or eye-hiding the stroke hides them instantly (the
  Stroke row keeps its + button), re-adding restores them, lines/arrows
  always show them, and multi-selections show them when at least one
  member has an active stroke;
  a 1–20 px stroke-width slider, opacity, and alignment. **No fill** and
  **No stroke** slash swatches remove fill/border (lines, arrows, and pencil
  strokes always keep a visible stroke). Text has an independent **text
  color** presented as the same compact swatch + HEX row as Fill/Stroke
  (swatch opens the advanced picker) and a font-size slider + numeric input + steppers (8–120 px), and
  contained text picks black/white automatically from the fill's WCAG
  luminance (**auto contrast**) until a manual text color turns it off — a
  panel toggle re-enables it (Fix 1.5). `Cmd/Ctrl+Shift+>` / `<` steps the
  selected text's font size by 1px (works on standalone text, shape text,
  multi-selections, and while editing; clamped 8–120; undoable — Fix 1.23).
- **Corner rotation zones** (Fix 1.45/1.45.1) — hover just outside any
  corner of a selection to get a **corner-matched** rotate cursor (each of
  the four corners shows its own orientation), then drag to rotate freely
  around the center. Rotation is context-aware: in crop/mask **edit mode**
  the corner zones rotate only the **image content inside the fixed mask**
  (stored separately as `crop.rotation`, live in exports and undoable on
  its own), while normal selection rotates the whole clipped object — single objects, lines/arrows, groups, multi-selections, frames,
  cropped/masked images alike. Shift snaps to 15°, the live angle readout
  and the sidebar Rotation field stay in sync, resize handles always win
  when grabbed directly, and each drag is one undo step.
- **Rotation & links** (Fix 1.6) — every element rotates via the handle above
  its selection frame (Shift snaps to 15° steps, live angle readout, exact
  angle input in the panel; lines/arrows/pencil bake rotation into points and
  detach connectors). Any selection can carry a hyperlink (Add/Edit/Open/
  Copy/Remove in the panel; bare domains become https://). Linked elements
  show a ↗ badge when selected or hovered that opens the URL; links export
  as clickable PDF annotations and SVG anchors, and survive save/duplicate/
  copy/import.
- **Frames** (Fix 1.17) — multiple named artboards inside one page for screen
  flows. The Frame tool (`F`, in More tools) drags custom frames or places
  presets (mobile/tablet/desktop/social/A4) at free positions; names
  auto-increment and are renamed by double-click or the panel. Frames carry
  their contents when moved, nudged, Alt-dragged, or duplicated — Cmd+D
  places the copy 100px beside the original ("Login Screen" → "Login Screen
  2"); deleting confirms "Delete frame and all contents?". A selected frame
  exports as PNG/SVG/PDF (links preserved), and Export → "Frames → PDF"
  emits one PDF page per frame. Frames render **unclipped** — a frame beside
  or overlapping the paper stays a fully visible white artboard (Fix 1.18).
  Right-click a frame for a context menu (rename / duplicate / export /
  reorder / lock / delete), a "+" beside the selected frame adds a same-size
  sibling, Alt+drag duplicates rename automatically, Enter saves a rename
  while Escape cancels it, and empty frame names are rejected. Frame labels
  render at a constant screen size, and **every canvas is a frame** (Fix
  1.19): new documents, preset canvases, and legacy fixed pages (migrated on
  load) are infinite pages holding a selectable white main frame — the "page
  paper" moves, renames, duplicates, rotates (the orientation toggle swaps
  the selected/first frame's dimensions), and exports like any artboard,
  with one shared frame interaction system. Selecting a frame shows four
  **ghost plus buttons** (Fix 1.20) — click one to create a blank matching
  frame above/below/left/right (100px gap, auto-named, collision-stepping,
  auto-selected and panned into view); Alt+click duplicates the frame with
  its contents in that direction. Each page's ⋯ menu also offers **Export
  page** (PNG/SVG/PDF for that page only), the top toolbar is trimmed to
  File / title / help / Export (undo-redo via keyboard), and a Portrait/
  Landscape segmented control sits atop the right sidebar for the selected
  frame, swapping its dimensions around its center (Fix 1.21). Page PDF
  exports emit **one frame-sized PDF page per frame** in reading order (top
  to bottom, left to right; frameless pages export their content box), and
  the rulers **re-origin to the selected frame** — 0 sits at its top-left
  (also when a child object is selected), with an accent 0 tick and a band
  marking the frame's extent (Fix 1.22).
- **More tools** (Fix 1.4) — a menu at the end of the floating toolbar with
  Web Embed (link prompt → selectable/movable placeholder card), Laser
  Pointer (`K`, temporary fading trail for presenting, creates nothing), and
  Lasso Selection (freeform multi-select that hands off to the select tool).
- **Dimensions & aspect-ratio lock** (Fix 1.34.1) — the panel's W/H inputs
  resize the selection from its center, and the lock icon between them works
  like Figma's: while locked, editing W updates H (and vice versa) using the
  ratio captured when the lock engaged, and **canvas handle resizing — corner
  and side handles alike — stays proportional** without holding Shift. The
  lock state is shared between the panel and the canvas. Defaults per
  selection: images, multi-selections, and square/circular shapes start
  locked; other shapes and frames start unlocked. Undo restores both
  dimensions in one step.
- **Frame clipping** (Fix 1.37/1.39) — frames clip their contents: every
  element type (shapes, lines, arrows, text, images, stickies, embeds,
  groups) can belong to a frame and is clipped at its boundary. Membership
  is **pointer-driven and persistent** (`frameId`, Fix 1.39): while
  dragging, the element joins the frame under the *cursor* — even if 80%
  of it hangs outside, it stays a clipped member until the cursor leaves
  the frame; no overlap-percentage or center rule ejects it. New elements
  join the frame they're drawn in, duplicated frames remap their children,
  moving/nudging a frame carries members, resizing never changes
  membership, and legacy documents migrate automatically. The hidden
  overflow is not clickable or erasable, the frame under the cursor glows
  while dragging, and PNG/SVG (clipPath)/PDF exports match the canvas.
- **Alignment & distribution** (Fix 1.38) — a single object inside a frame
  aligns to the frame's edges/centers (all 6 controls); multiple objects
  align to the selection bounds; rotated objects use their visual bounding
  box. Distribute Horizontally/Vertically appears for 2+ selected (a no-op
  with exactly 2, per Figma convention) and equalizes gaps between 3+.
  All actions are single undo steps. The W/H inputs step by **whole
  numbers** with the keyboard (Fix 1.40): Arrow ±1, Shift+Arrow ±5,
  decimals preserved (34.11 → 35.11), clamped to 1–10000, resizing live
  with one undo step per press; the ratio lock keeps the other axis in
  sync.
- **Clipping masks** (Fix 1.44) — select an image and a closed shape
  (rectangle incl. corner radius, ellipse, diamond, triangle) and press
  `Cmd/Ctrl+7` — or the browser-safe **M variants** (`Cmd/Ctrl+Shift+M`,
  `Cmd/Ctrl+Alt+Shift+M`) as fallbacks for browsers that reserve
  Cmd+number for tab switching (Safari/Atlas), or the sidebar's
  **Make clipping mask / Release mask** buttons and right-click actions (Fix 1.45.4). Shortcuts
  bind at window capture level with physical-key detection and a
  typing-field guard. Pressing `Cmd/Ctrl+7`: the topmost shape becomes a non-destructive mask and the
  image shows only inside it, as one selectable object with the shape's
  bounds. Double-click to reposition/scale the image inside the mask;
  `Cmd/Ctrl+Alt+7` (or the panel's "Release mask") splits it back into the
  original image and shape with their styles intact. Helpful toasts guide
  invalid selections; masks survive undo/redo, duplication, frames, and
  export to PNG/SVG (shape clipPath)/PDF. Mask shapes stay fully editable
  (Clipmask Fix 1.0): the orange **corner-radius dot** and the sidebar
  Corner radius control keep working after a rectangle/diamond/triangle
  becomes a mask — dragging rounds the clip path live without touching
  the image transform, rounded diamond/triangle masks render and export
  with true rounded paths, and releasing the mask restores the shape with
  its latest radius. Mask **edit mode** (Fix 1.44.1)
  makes the shape unmistakable: the full image shows dimmed with the mask
  path as a clear bright window, a solid blue outline traces the actual
  shape (triangle, ellipse, …), and a dotted blue rectangle marks the full
  image bounds — so positioning the right part of the image is precise.
- **Non-destructive image crop** (Fix 1.43) — double-click any image to
  enter crop mode: drag the content to reposition it inside the fixed mask,
  drag the round corner handles on the dotted content bounds to scale it
  proportionally, or drag the square handles to resize the mask itself (the
  content stays put). The hidden part shows as a translucent ghost; Escape,
  Enter, or clicking outside commits. The original image is always
  preserved — re-open crop mode anytime to reveal hidden parts, and use the
  panel's Image section (Crop / Fill / Fit / Reset crop) for one-click
  fitting. Crops survive resize, duplicate, undo/redo, save/import, frame
  clipping, and export to PNG/SVG (clipPath)/PDF. Crop mode uses the
  Figma-style UI (Fix 1.43.1): dotted blue crop boundary with thick solid
  blue handle blocks, the outside area dimmed while the kept area stays
  clear, and a live blue size label under the crop rectangle. The
  Dimensions **ratio lock governs crop-content scaling** (Fix 1.44.3):
  unlocked, the content corner handles free-transform (stretch) the image;
  locked — or holding Shift — they scale proportionally, and the mask/crop
  frame handles follow the same rule. **Alt/Option anchors the resize at
  the content's center** (Fix 1.45.3) — Shift+Alt scales proportionally
  from center, exactly like normal canvas objects, from any corner and
  even after the content has been moved or rotated.
- **Smart guides & measurements** (Fix 1.41) — while dragging, red
  alignment guides appear when the selection's visual box lines up (within
  5 screen px) with its frame's edges/centers or with sibling objects, and
  the selection **soft-snaps** to the guide; guides vanish on release.
  Holding **Alt/Option** enters measurement inspection (Fix 1.42): with
  nothing selected, simply hovering an object shows its distances to its
  parent frame's edges (no click needed); with a selection, hover
  another object to see the gap between closest edges (hovered object
  highlighted), hover a frame to see the selection's distances to its four
  edges (the parent frame when the cursor is inside it), or hover empty
  desk to fall back to the parent frame — all without dragging, updating
  live as the cursor or a drag moves (Alt-drag duplication still works).
  Overlays only: never saved or exported.
- **Multi-selection member outlines** (Fix 1.44.2) — selecting two or more
  objects shows, besides the solid group bounding box with its handles, a
  mild blue outline on every member following its actual path: rounded
  rectangles, ovals, triangles, diamonds, lines/arrows (incl. curves), and
  clipping masks trace their mask shape. Indicators only — no handles —
  and never exported.
- **Object controls** — multi-select (marquee / shift-click), move, resize,
  duplicate (Ctrl/Cmd+D or **Alt+drag**), delete, lock, group/ungroup,
  z-order, align (6 ways), copy/paste, nudge with arrow keys.
- **Persistence** — continuous autosave (~350 ms debounce) to IndexedDB;
  the session (including current page) restores automatically after a crash,
  tab close, or reboot. Corrupt saves are discarded gracefully.
- **Export** (top-right button) — multi-page PDF (mixed orientations
  supported), PNG per page, stitched PNG bundle, SVG per page, and JSON
  project file; JSON import restores everything.
- **Help** — `?` opens the shortcut reference. All shortcuts listed there.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Data model (Doc → Page → SketchElement), validation |
| `src/geometry.ts` | Bounds, hit-testing, shape-edge math, arrow binding |
| `src/render.ts` | rough.js element rendering, text measuring, image cache |
| `src/elementOps.ts` | Delete/duplicate/z-order/align/group operations |
| `src/persistence.ts` | IndexedDB session save/load |
| `src/export.ts` | PDF (jsPDF), PNG, JSON export/import |
| `src/CanvasArea.tsx` | Canvas engine: tools, selection, resize, pan/zoom, text editing |
| `src/App.tsx` | State, undo/redo history, autosave, shortcuts, wiring |
| `Toolbar / ToolPanel / PropertiesPanel / PagePanel` | UI panels |

Orientation rule: rotating a page keeps object coordinates; content past the
new edge is clipped in rendering/exports but remains selectable and movable.
