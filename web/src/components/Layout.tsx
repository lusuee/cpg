import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconDashboard,
  IconProviders,
  IconModels,
  IconDevices,
  IconUsage,
  IconSettings,
  IconLogOut,
  IconZap,
  IconMenu,
  IconClose,
} from "./icons";

const navItems = [
  { to: "/dashboard", label: "仪表盘", icon: IconDashboard },
  { to: "/providers", label: "Providers", icon: IconProviders },
  { to: "/models", label: "Models", icon: IconModels },
  { to: "/devices", label: "设备 Token", icon: IconDevices },
  { to: "/usage", label: "用量记录", icon: IconUsage },
  { to: "/settings", label: "系统设置", icon: IconSettings },
];

export default function Layout() {
  const { logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auto-close mobile drawer when location changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const currentTitle = navItems.find((n) => n.to === location.pathname)?.label || "AI Gateway";

  const renderNavList = () => (
    <nav className="p-3 space-y-1 overflow-y-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-50/80 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 shadow-sm shadow-blue-500/5 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"}`} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50/50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 h-screen sticky top-0 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col justify-between select-none overflow-y-auto z-20">
        <div className="flex flex-col min-h-0">
          {/* Brand header */}
          <div className="px-6 py-5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
              <IconZap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight text-sm tracking-tight">AI Gateway</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Personal Cloudflare API</div>
            </div>
          </div>

          {/* Nav links */}
          {renderNavList()}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Gateway 在线
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">v1.0</span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xl select-none animate-in slide-in-from-left duration-200">
            <div className="flex flex-col min-h-0">
              {/* Mobile Drawer Header */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
                    <IconZap className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight text-sm tracking-tight">AI Gateway</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Personal Cloudflare API</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="关闭导航菜单"
                >
                  <IconClose className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile Nav links */}
              {renderNavList()}
            </div>

            {/* Mobile Drawer Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 shrink-0 space-y-3">
              <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Gateway 在线
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">v1.0</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Header */}
        <header className="h-14 sm:h-16 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Hamburger menu button for mobile */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 -ml-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              aria-label="打开导航菜单"
            >
              <IconMenu className="w-5 h-5" />
            </button>
            <h1 className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100 tracking-tight">{currentTitle}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <Button variant="ghost" size="sm" onClick={() => logout()} title="退出登录">
              <IconLogOut className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span className="hidden sm:inline">退出登录</span>
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto animate-in fade-in duration-200">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

