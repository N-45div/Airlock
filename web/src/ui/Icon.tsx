// A small set of line icons, drawn on a 24px grid. Decorative only: every
// place that uses one also says the same thing in words.

const PATHS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  blocked: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M6 18L18 6'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'],
  shield: ['M12 3l7 3v5.5c0 4.3-3 8-7 9.5-4-1.5-7-5.2-7-9.5V6l7-3z', 'M9 12l2.2 2.2L15.5 10'],
  alert: ['M12 3.8L2.8 19.5h18.4L12 3.8z', 'M12 10v4', 'M12 17h.01'],
  stop: ['M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3z', 'M8 12h8'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  copy: [
    'M9 9h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9z',
    'M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3',
  ],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  chevron: ['M6 9l6 6 6-6'],
  read: [
    'M12 6.5C10.5 5.3 8.3 5 4 5v13c4.3 0 6.5.3 8 1.5 1.5-1.2 3.7-1.5 8-1.5V5c-4.3 0-6.5.3-8 1.5z',
    'M12 6.5v13',
  ],
  fence: [
    'M7 11V8a5 5 0 0 1 10 0v3',
    'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
    'M12 15v2',
  ],
  terminal: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M7 9.5l3 2.5-3 2.5', 'M12.5 15H17'],
  key: ['M7.5 13a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M10 14L19 5', 'M15.5 8.5l2.5 2.5', 'M17.5 6.5L20 9'],
  send: ['M21 3L10 14', 'M21 3l-7 18-4-7-7-4 18-7z'],
  hidden: [
    'M3 3l18 18',
    'M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6-.5 1-1.6 2.6-3.2 3.9',
    'M6.7 7.7C4.6 9 3.1 10.9 2.5 12c1 2 4.5 6 9.5 6 1.6 0 3-.4 4.3-1',
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  message: ['M4 5h16v11H9.5L5 19.5V16H4V5z', 'M8 9.5h8', 'M8 12.5h5'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z', 'M14 3v5h5'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 11v5', 'M12 8h.01'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
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
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The mark: an airlock door, two nested rounded squares with a seam. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <rect x="8.5" y="8.5" width="15" height="15" rx="4.5" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" />
      <path d="M16 12v8" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
