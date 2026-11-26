// Icons, 16 units square, drawn as lines in the current color.
const PATHS: Record<string, string> = {
  completed: "M3.5 8.5l3 3 6-7",
  failed: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  cancelled: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M4.2 11.8l7.6-7.6",
  retrying: "M13 8a5 5 0 1 1-1.6-3.7M13 2.8v3h-3",
  reused: "M3 8a5 5 0 1 0 1.6-3.7M3 2.8v3h3",
  waiting: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 5v3.2l2.2 1.4",
  step: "M8 1.8l5.5 3.1v6.2L8 14.2l-5.5-3.1V4.9zM2.5 4.9L8 8l5.5-3.1M8 8v6.2",
  dataset:
    "M2.5 4c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2v8c0 1.1-2.5 2-5.5 2s-5.5-.9-5.5-2zM2.5 4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2",
  signals: "M3 13.5v-11M3 3h9.5l-2 3 2 3H3",
  loops: "M8 8C6.5 5.8 5.5 5 4.2 5a3 3 0 0 0 0 6C5.5 11 6.5 10.2 8 8s2.5-3 3.8-3a3 3 0 0 1 0 6C10.5 11 9.5 10.2 8 8",
  search: "M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M10.3 10.3L13.5 13.5",
  pipelines: "M2.5 3.5h4v3h-4zM9.5 9.5h4v3h-4zM6.5 5h2a1.5 1.5 0 0 1 1.5 1.5v3",
  runs: "M2.5 8h2.5l1.5-4 3 8 1.5-4h2.5",
  workers: "M3 3h10v4H3zM3 9h10v4H3zM5.5 5h.01M5.5 11h.01",
  arrow: "M3 8h10M9.5 4.5L13 8l-3.5 3.5",
  chevron: "M6 3.5L10.5 8 6 12.5",
  "chevron-left": "M10 3.5L5.5 8 10 12.5",
  group: "M2 4.5h4l1.2 1.5H14v6.5H2z",
  back: "M13 8H3M6.5 4.5L3 8l3.5 3.5",
  saved: "M8 1.8l5 2v3.6c0 3.1-2.1 5.5-5 6.8-2.9-1.3-5-3.7-5-6.8V3.8zM5.6 8.1l1.7 1.7 3.2-3.4",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  if (name === "running") {
    return (
      <svg className="spin" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.step} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Logo: moksha's mark, a ring let go of a dot.
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--run)" />
        </linearGradient>
      </defs>
      <path d="M15.5 6.2A7 7 0 1 0 17 10" fill="none" stroke="url(#logo-g)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16.6" cy="3.6" r="2" fill="var(--accent)" />
    </svg>
  );
}
