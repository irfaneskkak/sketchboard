import { useEffect, useState } from 'react';

export interface CanvasChoice {
  presetId: string;
  label: string;
  /** null dimensions = infinite freeform canvas */
  w: number | null;
  h: number | null;
}

interface Preset {
  id: string;
  label: string;
  w: number | null;
  h: number | null;
}

const CATEGORIES: { name: string; presets: Preset[] }[] = [
  {
    name: 'Default',
    presets: [{ id: 'blank-infinite', label: 'Blank Infinite Canvas', w: null, h: null }],
  },
  {
    name: 'Paper',
    presets: [
      { id: 'a4-portrait', label: 'A4 Portrait', w: 794, h: 1123 },
      { id: 'a4-landscape', label: 'A4 Landscape', w: 1123, h: 794 },
      { id: 'a3-portrait', label: 'A3 Portrait', w: 1123, h: 1587 },
      { id: 'a3-landscape', label: 'A3 Landscape', w: 1587, h: 1123 },
    ],
  },
  {
    name: 'Presentation',
    presets: [
      { id: 'slide-16-9', label: '16:9 Wide Slide', w: 1920, h: 1080 },
      { id: 'slide-4-3', label: '4:3 Standard Slide', w: 1024, h: 768 },
    ],
  },
  {
    name: 'Mobile',
    presets: [
      { id: 'mobile-iphone', label: 'iPhone / Mobile Screen', w: 390, h: 844 },
      { id: 'mobile-android', label: 'Android Mobile Screen', w: 360, h: 800 },
      { id: 'mobile-large', label: 'Large Mobile Screen', w: 430, h: 932 },
    ],
  },
  {
    name: 'Tablet',
    presets: [
      { id: 'tablet-portrait', label: 'iPad / Tablet Portrait', w: 768, h: 1024 },
      { id: 'tablet-landscape', label: 'iPad / Tablet Landscape', w: 1024, h: 768 },
    ],
  },
  {
    name: 'Desktop',
    presets: [
      { id: 'desktop-web', label: 'Desktop Web', w: 1440, h: 1024 },
      { id: 'laptop-web', label: 'Laptop Web', w: 1366, h: 768 },
      { id: 'desktop-fhd', label: 'Full HD Desktop', w: 1920, h: 1080 },
    ],
  },
  {
    name: 'Social Media',
    presets: [
      { id: 'instagram-post', label: 'Instagram Post', w: 1080, h: 1080 },
      { id: 'instagram-story', label: 'Instagram Story / Reel', w: 1080, h: 1920 },
      { id: 'instagram-portrait', label: 'Instagram Portrait Post', w: 1080, h: 1350 },
      { id: 'linkedin-post', label: 'LinkedIn Post', w: 1200, h: 1200 },
      { id: 'linkedin-banner', label: 'LinkedIn Banner', w: 1584, h: 396 },
      { id: 'youtube-thumbnail', label: 'YouTube Thumbnail', w: 1280, h: 720 },
      { id: 'youtube-channel-art', label: 'YouTube Channel Art', w: 2560, h: 1440 },
      { id: 'facebook-post', label: 'Facebook Post', w: 1200, h: 630 },
      { id: 'twitter-post', label: 'X / Twitter Post', w: 1600, h: 900 },
    ],
  },
];

const CUSTOM_MIN = 100;
const CUSTOM_MAX = 10000;

interface Props {
  onCreate: (choice: CanvasChoice) => void;
  onClose: () => void;
}

export function CreateCanvasModal({ onCreate, onClose }: Props) {
  const [selected, setSelected] = useState<Preset | null>(null);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [customActive, setCustomActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const create = () => {
    if (customActive) {
      const w = Math.round(Number(customW));
      const h = Math.round(Number(customH));
      if (!Number.isFinite(w) || !Number.isFinite(h) || !customW.trim() || !customH.trim()) {
        setError('Width and height are required.');
        return;
      }
      if (w < CUSTOM_MIN || h < CUSTOM_MIN) {
        setError(`Minimum size is ${CUSTOM_MIN} × ${CUSTOM_MIN} px.`);
        return;
      }
      if (w > CUSTOM_MAX || h > CUSTOM_MAX) {
        setError(`Maximum size is ${CUSTOM_MAX} × ${CUSTOM_MAX} px.`);
        return;
      }
      onCreate({ presetId: 'custom', label: 'Custom Canvas', w, h });
      return;
    }
    if (selected) {
      onCreate({ presetId: selected.id, label: selected.label, w: selected.w, h: selected.h });
    }
  };

  const pick = (p: Preset) => {
    setSelected(p);
    setCustomActive(false);
    setError(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal create-canvas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New Canvas</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="preset-scroll">
          {CATEGORIES.map((cat) => (
            <section key={cat.name}>
              <h4 className="preset-category">{cat.name}</h4>
              <div className="preset-grid">
                {cat.presets.map((p) => (
                  <button
                    key={p.id}
                    className={`preset-card ${!customActive && selected?.id === p.id ? 'active' : ''}`}
                    onClick={() => pick(p)}
                    onDoubleClick={() => {
                      pick(p);
                      onCreate({ presetId: p.id, label: p.label, w: p.w, h: p.h });
                    }}
                  >
                    <span className="preset-name">{p.label}</span>
                    <span className="preset-size">{p.w ? `${p.w} × ${p.h} px` : 'Infinite / Freeform'}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h4 className="preset-category">Custom Size</h4>
            <div
              className={`preset-card custom-size-card ${customActive ? 'active' : ''}`}
              onClick={() => {
                setCustomActive(true);
                setSelected(null);
                setError(null);
              }}
            >
              <div className="custom-size-inputs">
                <input
                  type="number"
                  placeholder="Width"
                  min={CUSTOM_MIN}
                  max={CUSTOM_MAX}
                  value={customW}
                  onFocus={() => {
                    setCustomActive(true);
                    setSelected(null);
                  }}
                  onChange={(e) => {
                    setCustomW(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') create();
                  }}
                  aria-label="Custom width in pixels"
                />
                <span>×</span>
                <input
                  type="number"
                  placeholder="Height"
                  min={CUSTOM_MIN}
                  max={CUSTOM_MAX}
                  value={customH}
                  onFocus={() => {
                    setCustomActive(true);
                    setSelected(null);
                  }}
                  onChange={(e) => {
                    setCustomH(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') create();
                  }}
                  aria-label="Custom height in pixels"
                />
                <span className="preset-size">px</span>
              </div>
              {error && <div className="link-error">{error}</div>}
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <button className="toolbar-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="toolbar-btn primary"
            onClick={create}
            disabled={!customActive && !selected}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
