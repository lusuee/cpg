import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui";
import {
  IconDashboard,
  IconProviders,
  IconModels,
  IconDevices,
  IconUsage,
  IconSettings,
  IconLogOut,
  IconZap,
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

  const currentTitle = navItems.find((n) => n.to === location.pathname)?.label || "AI Gateway";

  return (
    <div className="flex min-h-screen bg-slate-50/50">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-200/80 bg-white flex flex-col justify-between select-none">
        <div>
          {/* Brand header */}
          <div className="px-6 py-5 flex items-center gap-3 border-b border-slate-100">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <IconZap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-slate-900 leading-tight text-sm tracking-tight">AI Gateway</div>
              <div className="text-[11px] text-slate-400 font-medium">Personal Cloudflare API</div>
            </div>
          </div>

          {/* Nav links */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? "bg-blue-50/80 text-blue-700 shadow-sm shadow-blue-500/5 font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-50 text-xs text-slate-500">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Gateway 在线
            </span>
            <span className="text-[10px] text-slate-400">v1.0</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between border-b border-slate-200/80 bg-white/80 backdrop-blur-md px-8 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 tracking-tight">{currentTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              <IconLogOut className="w-4 h-4 text-slate-500" />
              <span>退出登录</span>
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-8 max-w-7xl w-full mx-auto animate-in fade-in duration-200">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
