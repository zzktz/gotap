import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { exit } from "@tauri-apps/plugin-process";
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

interface AppHeaderMenuProps {
  onLogout: () => void;
  onFeedback: () => void;
}

/** Shared account/help menu shown by the home page and feature modules. */
export function AppHeaderMenu({ onLogout, onFeedback }: AppHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="about-menu-wrap" ref={menuRef}>
      <Button
        aria-label="打开账户菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        className="topbar-action"
        onPress={() => setOpen((value) => !value)}
        size="sm"
        title="账户菜单"
        variant="light"
      >
        <span className="help-icon" aria-hidden="true">?</span>
      </Button>
      {open && (
        <div className="about-menu" role="menu">
          <button onClick={() => { setOpen(false); onFeedback(); }} role="menuitem" type="button">问题反馈</button>
          <button onClick={() => { setOpen(false); onLogout(); }} role="menuitem" type="button">退出登录</button>
          <button onClick={() => { setOpen(false); void exit(0); }} role="menuitem" type="button">退出程序</button>
        </div>
      )}
    </div>
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
