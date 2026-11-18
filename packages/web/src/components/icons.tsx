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
export const WorkIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" /><path d="M5.5 5h13l2 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z" /></Svg>
);
export const ProjectsIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /></Svg>
);
export const QuestionIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 5.5h16v10.5H10l-4 3.5v-3.5H4z" /><path d="M10 9a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.4M12 13.8h.01" /></Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 21 19.5H3z" /><path d="M12 10v4M12 16.8h.01" /></Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M10.2 8.8v6.4l5-3.2z" /></Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.3 12.3l2.5 2.5 5-5.3" /></Svg>
);
export const DocIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M9.5 12.5h6M9.5 16h6" /></Svg>
);
export const PullRequestIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /><path d="M6.5 7.5v9M17.5 16.5V9a2.5 2.5 0 0 0-2.5-2.5h-3.5M13.5 4.5l-2 2 2 2" /></Svg>
);
export const BranchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="7.5" r="2" /><path d="M6.5 7.5v9M17.5 9.5c0 4-4 4-9 7" /></Svg>
);
export const TaskIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12.2l2.6 2.6L16 9.4" /></Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" /></Svg>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Svg>
);
