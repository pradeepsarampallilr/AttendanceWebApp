/** Small inline icons (no icon library needed) and the LiveRamp / Indian flag mark used in the header. */
import logo from '../assets/liveramp-logo.svg';
type P = { className?: string };
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const DashboardIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const AttendanceIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 11.5l2.2 2.2 3.8-4.2" /></svg>
);
export const CalendarIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
);
export const ShieldIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const SettingsIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
);
export const UsersIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></svg>
);
export const HomeIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M3 11l9-8 9 8" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" /></svg>
);
export const DownloadIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
);
export const LogoutIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" /></svg>
);

export const ClockIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const CheckCircleIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></svg>
);
export const BuildingIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M3 21h18M9 7h2M9 11h2M9 15h2" /></svg>
);
export const TrendIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>
);
export const ListIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
);
export const TargetIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
);
export const LoginIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H8" /></svg>
);
export const FootprintIcon = ({ className = 'h-4 w-4' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="5" r="2" /><path d="M12 8v6l-3 6M12 14l3 6M8 11l4-3 4 3" /></svg>
);

export function IndianFlag({ className = 'h-4 w-6' }: P) {
  return (
    <svg viewBox="0 0 36 24" className={`${className} rounded-sm shadow-sm ring-1 ring-black/10`} role="img" aria-label="India">
      <rect width="36" height="8" fill="#FF9933" />
      <rect y="8" width="36" height="8" fill="#FFFFFF" />
      <rect y="16" width="36" height="8" fill="#138808" />
      <circle cx="18" cy="12" r="3" fill="none" stroke="#000080" strokeWidth=".8" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="18" y1="12" x2={18 + 3 * Math.cos((i * Math.PI) / 6)} y2={12 + 3 * Math.sin((i * Math.PI) / 6)} stroke="#000080" strokeWidth=".4" />
      ))}
    </svg>
  );
}

/** The official LiveRamp wordmark (SVG from liveramp.com). */
export function LiveRampMark({ className = 'h-5' }: P) {
  return <img src={logo} alt="LiveRamp" className={`${className} w-auto`} />;
}
