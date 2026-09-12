import type { CSSProperties } from "react";

const paths = {
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m16 16 4.4 4.4" />
    </>
  ),
  arrow: (
    <>
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <path d="m14 5-7 7 7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  edit: (
    <>
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" />
    </>
  ),
  wifi: (
    <>
      <path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a4 4 0 0 1 6 0" />
      <circle cx="12" cy="20" r=".4" />
    </>
  ),
  offline: (
    <>
      <path d="m3 3 18 18M3 8a15 15 0 0 1 3-1.6M9 5.5A15 15 0 0 1 21 8M6 12a10 10 0 0 1 3-1.5m5 .1a10 10 0 0 1 4 1.4m-9 4a4 4 0 0 1 6 0" />
      <circle cx="12" cy="20" r=".4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2m2-14a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
export function BrandMark() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 5h14v10H11l-6 4V5Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
      <path
        d="M9 9h6m-6 3h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
