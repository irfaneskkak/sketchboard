import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
import type { Tool } from './types';

const TOOLS: { tool: Tool; icon: keyof typeof Icons; label: string; key: string }[] = [
  { tool: 'select', icon: 'select', label: 'Select', key: 'V or 1' },
  { tool: 'rectangle', icon: 'rectangle', label: 'Rectangle', key: 'R or 2' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O or 3' },
  { tool: 'diamond', icon: 'diamond', label: 'Diamond', key: 'D or 4' },
  { tool: 'triangle', icon: 'triangle', label: 'Triangle', key: 'Y' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L or 5' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A or 6' },
  { tool: 'pencil', icon: 'pencil', label: 'Pencil', key: 'P or 7' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T or 8' },
  { tool: 'sticky', icon: 'sticky', label: 'Sticky note', key: 'N or 9' },
  { tool: 'image', icon: 'image', label: 'Insert image', key: 'I' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E or 0' },
];

const MORE_TOOLS: { tool: Tool; icon: keyof typeof Icons; label: string; shortcut?: string }[] = [
  { tool: 'frame', icon: 'frame', label: 'Frame', shortcut: 'F' },
  { tool: 'embed', icon: 'embed', label: 'Web Embed' },
  { tool: 'laser', icon: 'laser', label: 'Laser Pointer', shortcut: 'K' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso Selection' },
];

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
}

function MoreToolsMenu({ tool, setTool }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeMore = MORE_TOOLS.some((t) => t.tool === tool);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="more-tools" ref={ref}>
      <button
        className={`icon-btn tool-btn ${activeMore || open ? 'active' : ''}`}
        title="More tools"
        aria-label="More tools"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {Icons.moreTools}
      </button>
      {open && (
        <div className="more-tools-menu" role="menu" aria-label="More tools">
          {MORE_TOOLS.map((t) => (
            <button
              key={t.tool}
              className={`menu-item ${tool === t.tool ? 'active' : ''}`}
              role="menuitem"
              onClick={() => {
                setTool(t.tool);
                setOpen(false);
              }}
            >
              <span className="menu-item-icon">{Icons[t.icon]}</span>
              <span className="menu-item-label">{t.label}</span>
              {t.shortcut && <kbd>{t.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolPanel({ tool, setTool }: Props) {
  return (
    <div className="tool-panel" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`icon-btn tool-btn ${tool === t.tool ? 'active' : ''}`}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.tool}
          onClick={() => setTool(t.tool)}
        >
          {Icons[t.icon]}
        </button>
      ))}
      <div className="tool-divider" />
      <MoreToolsMenu tool={tool} setTool={setTool} />
    </div>
  );
}
