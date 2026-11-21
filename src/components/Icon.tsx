const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5',
  herd: 'M4 9c0-2 1.5-3.5 3-4M20 9c0-2-1.5-3.5-3-4M7 8h10l1.5 4-2 1.5V18a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-4.5l-2-1.5L7 8ZM10 16h.01M14 16h.01',
  pasture: 'M3 20h18M6 20c0-4 1-7 3-9M12 20c0-5 .5-9 2-12M18 20c0-3-1-6-3-8M9 11c-1.5-.5-3-.3-4 .5M14 8c1.5-1 3-1.2 4.5-.8',
  calf: 'M12 21c4.4 0 8-3.1 8-7 0-5-4-9-8-11-4 2-8 6-8 11 0 3.9 3.6 7 8 7ZM12 9v6M9 12h6',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7Zm14 0-3 7a3.5 3.5 0 0 0 6 0l-3-7ZM8 21h8',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 10v4M19 10v4',
  vault: 'M4 4h16v16H4zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 9V7.5M15 12h1.5M4 8H2M4 16H2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2ZM16 14h.01',
  cloudOff: 'M2 2l20 20M5.8 8.4A5 5 0 0 0 7 18h10.5M20.6 15.5A4 4 0 0 0 17 9h-1.3A7 7 0 0 0 9.5 5.2',
  cloud: 'M17.5 19H7a5 5 0 1 1 1.6-9.7A7 7 0 0 1 21 12.5 4 4 0 0 1 17.5 19Z',
  check: 'M4 12.5 9 17.5 20 6.5',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM8.5 12l2.5 2.5 4.5-5',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3ZM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  refresh: 'M20 11a8 8 0 0 0-14.8-3.5M4 4v4h4M4 13a8 8 0 0 0 14.8 3.5M20 20v-4h-4',
  arrows: 'M4 8h15l-4-4M20 16H5l4 4',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  minusCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12h8',
  clipboard: 'M9 3h6v4H9zM9 5H5v16h14V5h-4M8.5 13l2.5 2.5 4.5-4.5',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
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
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
