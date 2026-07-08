import type { ReactNode } from 'react';

function svg(children: ReactNode, viewBox = '0 0 24 24') {
  return (
    <svg
      width="18"
      height="18"
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  select: svg(<path d="M6 3l12 9-5.5 1L15 19l-2.5 1-2.5-6L6 17V3z" />),
  rectangle: svg(<rect x="4" y="6" width="16" height="12" rx="1" />),
  ellipse: svg(<ellipse cx="12" cy="12" rx="8" ry="6" />),
  diamond: svg(<path d="M12 3l9 9-9 9-9-9z" />),
  line: svg(<path d="M4 20L20 4" />),
  arrow: svg(
    <>
      <path d="M4 20L18 6" />
      <path d="M10 5h8v8" />
    </>
  ),
  pencil: svg(<path d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3" />),
  text: svg(
    <>
      <path d="M5 6V4h14v2" />
      <path d="M12 4v16M9 20h6" />
    </>
  ),
  sticky: svg(
    <>
      <path d="M4 4h16v10l-6 6H4V4z" />
      <path d="M14 20v-6h6" />
    </>
  ),
  image: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </>
  ),
  eraser: svg(
    <>
      <path d="M7 20h13" />
      <path d="M6 14L14 6l5 5-8 8H8l-2-2 0-3z" />
    </>
  ),
  undo: svg(
    <>
      <path d="M8 5L4 9l4 4" />
      <path d="M4 9h10a6 6 0 016 6v1" />
    </>
  ),
  redo: svg(
    <>
      <path d="M16 5l4 4-4 4" />
      <path d="M20 9H10a6 6 0 00-6 6v1" />
    </>
  ),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  trash: svg(
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  duplicate: svg(
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 4H4v12" />
    </>
  ),
  lock: svg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  unlock: svg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V7a4 4 0 017.5-1.9" />
    </>
  ),
  group: svg(
    <>
      <rect x="3" y="3" width="10" height="10" rx="1" />
      <rect x="11" y="11" width="10" height="10" rx="1" strokeDasharray="3 2" />
    </>
  ),
  ungroup: svg(
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </>
  ),
  toFront: svg(
    <>
      <rect x="8" y="4" width="12" height="12" rx="1" />
      <path d="M4 10v10h10" strokeDasharray="3 2" />
    </>
  ),
  toBack: svg(
    <>
      <rect x="4" y="8" width="12" height="12" rx="1" />
      <path d="M10 4h10v10" strokeDasharray="3 2" />
    </>
  ),
  forward: svg(<path d="M12 20V6M6 12l6-6 6 6" />),
  backward: svg(<path d="M12 4v14M6 12l6 6 6-6" />),
  alignLeft: svg(<path d="M4 4v16M8 8h10M8 14h6" />),
  alignCenterX: svg(<path d="M12 4v16M6 8h12M8 14h8" />),
  alignRight: svg(<path d="M20 4v16M6 8h10M10 14h6" />),
  alignTop: svg(<path d="M4 4h16M8 8v10M14 8v6" />),
  alignCenterY: svg(<path d="M4 12h16M8 6v12M14 8v8" />),
  alignBottom: svg(<path d="M4 20h16M8 6v10M14 10v6" />),
  distributeHorizontal: svg(
    <>
      <path d="M4 5v14M20 5v14" />
      <rect x="7" y="8" width="3" height="8" rx="0.8" />
      <rect x="11" y="8" width="3" height="8" rx="0.8" />
      <rect x="15" y="8" width="3" height="8" rx="0.8" />
    </>
  ),
  distributeVertical: svg(
    <>
      <path d="M5 4h14M5 20h14" />
      <rect x="8" y="7" width="8" height="3" rx="0.8" />
      <rect x="8" y="11" width="8" height="3" rx="0.8" />
      <rect x="8" y="15" width="8" height="3" rx="0.8" />
    </>
  ),
  portrait: svg(<rect x="7" y="4" width="10" height="16" rx="1" />),
  landscape: svg(<rect x="4" y="7" width="16" height="10" rx="1" />),
  zoomIn: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5M8 11h6M11 8v6" />
    </>
  ),
  zoomOut: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5M8 11h6" />
    </>
  ),
  fit: svg(
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </>
  ),
  download: svg(<path d="M12 4v11M7 10l5 5 5-5M4 20h16" />),
  upload: svg(<path d="M12 15V4M7 9l5-5 5 5M4 20h16" />),
  file: svg(
    <>
      <path d="M6 3h9l4 4v14H6V3z" />
      <path d="M15 3v4h4" />
    </>
  ),
  help: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </>
  ),
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
  chevronLeft: svg(<path d="M15 5l-7 7 7 7" />),
  chevronRight: svg(<path d="M9 5l7 7-7 7" />),
  pages: svg(
    <>
      <rect x="4" y="7" width="12" height="14" rx="1" />
      <path d="M8 4h12v13" />
    </>
  ),
  moreTools: svg(
    <>
      <path d="M7 10L10.5 4l3.5 6z" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <circle cx="17" cy="16.5" r="3.5" />
    </>
  ),
  embed: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c-2.8 2.6-2.8 15.4 0 18M12 3c2.8 2.6 2.8 15.4 0 18" />
    </>
  ),
  laser: svg(
    <>
      <path d="M4 20l7-7" />
      <path d="M13 4v3M20 11h-3M18.5 5.5l-2.2 2.2M13.6 10.4L20 4" strokeWidth="1.5" />
      <circle cx="12.5" cy="11.5" r="1.6" />
    </>
  ),
  lasso: svg(
    <>
      <path d="M12 4c4.4 0 8 2.2 8 5.5S16.4 15 12 15c-2 0-3.9-.5-5.3-1.3" strokeDasharray="3.5 2.5" />
      <path d="M4 9.5C4 6.2 7.6 4 12 4" strokeDasharray="3.5 2.5" />
      <path d="M6.7 13.7C5.5 15 5 16.5 5.5 18c.4 1.2 1.5 2 2.8 2" />
      <circle cx="6.5" cy="13.5" r="1.4" />
    </>
  ),
  list: svg(
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="5" cy="6" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  grid: svg(
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  frame: svg(
    <>
      <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
    </>
  ),
  triangle: svg(<path d="M12 4l9 16H3z" />),
  eye: svg(
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: svg(
    <>
      <path d="M4 4l16 16" />
      <path d="M10 5.8A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.3 3.9M6.4 6.9A16.4 16.4 0 002.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" />
    </>
  ),
  minus: svg(<path d="M6 12h12" />),
  dots: svg(
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};
