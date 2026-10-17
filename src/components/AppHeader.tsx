import type { ReactNode } from "react";
import logoUrl from "../logo.png";

interface AppHeaderProps {
  subtitle: string;
  accountEmail: string;
  versionBadge: ReactNode;
  children: ReactNode;
  menu?: ReactNode;
}

export function CursorLogo() {
  return (
    <img
      aria-label="GoTap 鼠标箭头标志"
      className="cursor-logo"
      src={logoUrl}
    />
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
