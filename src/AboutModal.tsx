import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';

/**
 * Profile image asset (Fix 1.36 §6). Falls back to the placeholder if the
 * local headshot asset is missing.
 */
const PROFILE_IMAGE = '/assets/Irfan Eskkak_Headshot.png';
const PROFILE_PLACEHOLDER = '/assets/irfan-profile-placeholder.svg';

const LINKS = [
  {
    icon: Icons.globe,
    label: 'Website',
    href: 'https://irfaneskkak.com',
    aria: 'Visit Irfan Eskkak website',
  },
  {
    icon: Icons.linkedin,
    label: 'LinkedIn',
    href: 'https://linkedin.com/in/irfaneskkak',
    aria: 'Open Irfan Eskkak LinkedIn',
  },
  {
    icon: Icons.whatsapp,
    label: 'WhatsApp',
    href: 'https://wa.me/919688988228',
    aria: 'Contact Irfan Eskkak on WhatsApp',
  },
];

/** About popup (Fix 1.36): profile card with contact links. */
export function AboutModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [imgSrc, setImgSrc] = useState(PROFILE_IMAGE);

  // Focus the dialog on open; restore focus to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-label="About"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>About</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close about">
            {Icons.close}
          </button>
        </div>
        <div className="about-body">
          <div className="about-content">
            <h2 className="about-name">Irfan Eskkak</h2>
            <p className="about-bio">
              Senior UX Engineer with 8+ years of experience designing intuitive SaaS, web, and
              mobile products. I combine user-centered design with AI-powered workflows to create
              scalable, high-impact digital experiences that solve real business problems.
            </p>
            <div className="about-links">
              {LINKS.map((l) => (
                <a
                  key={l.label}
                  className="about-link"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={l.aria}
                  title={l.label}
                >
                  {l.icon}
                  <span>{l.label}</span>
                </a>
              ))}
            </div>
          </div>
          <div className="about-photo">
            <img
              src={imgSrc}
              alt="Irfan Eskkak"
              onError={() => {
                if (imgSrc !== PROFILE_PLACEHOLDER) setImgSrc(PROFILE_PLACEHOLDER);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
