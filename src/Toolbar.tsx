import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
// White wordmark variant — the toolbar background is dark.
import logoWhite from './assets/logo-white.svg';

interface Props {
  title: string;
  onTitleChange: (t: string) => void;
  onNew: () => void;
  onImport: () => void;
  onExportPDF: () => void;
  onExportPNGs: () => void;
  onExportPNGBundle: () => void;
  onExportSVGs: () => void;
  onExportFramesPDF: () => void;
  onExportJSON: () => void;
  onClearPage: () => void;
  exporting: boolean;
  onHelp: () => void;
  onAbout: () => void;
}

function Menu({
  label,
  icon,
  items,
  disabled,
  align = 'left',
  primary = false,
}: {
  label: string;
  icon?: React.ReactNode;
  items: { label: string; hint?: string; onClick: () => void }[];
  disabled?: boolean;
  align?: 'left' | 'right';
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className={`toolbar-btn ${primary ? 'primary' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div className={`menu-dropdown ${align === 'right' ? 'align-right' : ''}`}>
          {items.map((item) => (
            <button
              key={item.label}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar(props: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-group brand">
        <img className="app-logo" src={logoWhite} alt="Sketchboard" />
        <span className="beta-tag">Beta</span>
      </div>

      <div className="toolbar-group">
        <Menu
          label="File"
          items={[
            { label: 'New document', hint: 'starts fresh', onClick: props.onNew },
            { label: 'Import project (JSON)…', onClick: props.onImport },
            { label: 'Clear current page…', onClick: props.onClearPage },
          ]}
        />
      </div>

      <input
        className="title-input"
        value={props.title}
        onChange={(e) => props.onTitleChange(e.target.value)}
        aria-label="Document title"
        spellCheck={false}
      />

      <div className="toolbar-group right">
        <button className="icon-btn" onClick={props.onAbout} title="About" aria-label="About">
          {Icons.info}
        </button>
        <button className="icon-btn" onClick={props.onHelp} title="Help and keyboard shortcuts (?)">
          {Icons.help}
        </button>
        <Menu
          label={props.exporting ? 'Exporting…' : 'Export'}
          icon={Icons.upload}
          disabled={props.exporting}
          align="right"
          primary
          items={[
            { label: 'PDF', hint: 'all pages, one file', onClick: props.onExportPDF },
            { label: 'PNG', hint: 'one file per page', onClick: props.onExportPNGs },
            { label: 'PNG bundle', hint: 'all pages stitched', onClick: props.onExportPNGBundle },
            { label: 'SVG', hint: 'one file per page', onClick: props.onExportSVGs },
            { label: 'Frames → PDF', hint: 'one page per frame', onClick: props.onExportFramesPDF },
            { label: 'Project file (JSON)', hint: 'reopen later', onClick: props.onExportJSON },
          ]}
        />
      </div>
    </div>
  );
}
