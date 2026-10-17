import type { ReactNode } from "react";

interface AppHeaderProps {
  subtitle: string;
  accountEmail: string;
  versionBadge: ReactNode;
  children: ReactNode;
  menu?: ReactNode;
}

export function CursorLogo() {
  return (
    <svg
      aria-label="GoTap 鼠标箭头标志"
      className="cursor-logo"
      role="img"
      viewBox="0 0 1024 1024"
    >
      <rect width="1024" height="1024" fill="#1768a7" />
      <path
        d="M842 562 422 422l140 420 117-117 94 94 46-47-93-93 116-117Z"
        fill="#fff"
      />
      <path
        d="M248 743V248h495v213l66 22V182H182v627h301l-22-66H248Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Shared application chrome for the home page and every feature module. */
export default function AppHeader({
  subtitle,
  accountEmail,
  versionBadge,
  children,
  menu,
}: AppHeaderProps) {
  return (
    <header className="topbar module-topbar">
      <div className="brand">
        <div className="brand-mark"><CursorLogo /></div>
        <div>
          <div className="brand-title">
            <strong>GoTap</strong>
            {versionBadge}
          </div>
          <small className="brand-subtitle">{subtitle}</small>
        </div>
      </div>
      <div className="module-account">
        {children}
        <span className="module-account-avatar" aria-hidden="true">
          {accountEmail.slice(0, 1).toUpperCase()}
        </span>
        <span className="module-account-email">{accountEmail}</span>
        {menu}
      </div>
    </header>
  );
}
