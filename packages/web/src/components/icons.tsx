import type { SVGProps } from "react";

/** Inline stroke icons (24×24, currentColor, decorative). No icon library. */
export type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const MachinesIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="6.5" rx="1.5" /><rect x="3" y="13.5" width="18" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01M11 7.25h6M11 16.75h6" /></Svg>
);
export const SubscriptionsIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 16a8 8 0 1 1 15 0" /><path d="M12 14l3.5-4.5" /><path d="M5 19.5h14" /></Svg>
);
export const ProxyIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></Svg>
);
export const SecretsIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5L20 3M16 7l3 3M13.5 9.5l2 2" /></Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>
);
export const MonitorIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const DotIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /></Svg>
);
