/** Small inline SVG icon set (no external icon library). Decorative by default. */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M9 12.5l2 2 4-4.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  alert: 'M12 8v5m0 3.5v.01M10.3 3.9L2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 5v3h3M4 13a8 8 0 0 0 14.9 3M20 19v-3h-3',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  video: 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 10l5-3v10l-5-3',
  text: 'M5 6h14M5 10h14M5 14h10M5 18h7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  moreHorizontal: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  if (name === 'moreHorizontal') {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Application mark: violet gradient tile with a check (the app's own identity). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e1833" />
          <stop offset="1" stopColor="#6b5fc0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#brand-mark-gradient)" />
      <path d="M9.5 16.5l4.5 4.5 8.5-9.5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
