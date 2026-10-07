import type { SVGProps } from 'react';

const P: Record<string, string> = {
  pointer: 'M5 3l13 7-6 1.5L9.5 18 5 3z',
  brush: 'M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8.4 12l9.2-9.2zM8 13l3 3c0 2.8-2.2 5-5 5H3c1.5-1 2-2.4 2-4a3 3 0 0 1 3-4z',
  knife: 'M3 21l9-9M14 4l6 6-3.5 3.5L11 8z M11 8l-1.5 1.5',
  city: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17.5l9 5 9-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.5-4.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  flat: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z M9 4v14 M15 6v14',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
  x: 'M6 6l12 12 M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6 M14 11l4 4-4 4 M6 21v-4',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z',
  pipette: 'M14 4l6 6 M17 7l-9.5 9.5L4 20l3.5-3.5 M12 6l6 6 M16.5 3.5a2.1 2.1 0 0 1 3 3L17 9l-3-3z',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4',
  file: 'M6 3h8l5 5v13H6z M14 3v5h5',
  check: 'M5 12l5 5 9-10',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  mountain: 'M3 20l6-11 4 6 2-3 6 8z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5h.01',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  heal: 'M4.9 13.4l5.7 5.7a3 3 0 0 0 4.2 0l4.3-4.3a3 3 0 0 0 0-4.2l-5.7-5.7a3 3 0 0 0-4.2 0L4.9 9.2a3 3 0 0 0 0 4.2z M10 12h.01 M12 10h.01 M12 14h.01 M14 12h.01',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={P[name]} />
    </svg>
  );
}
