import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui";

const nav = [
  { to: "/dashboard", label: "仪表盘" },
  { to: "/providers", label: "Providers" },
  { to: "/models", label: "Models" },
  { to: "/devices", label: "设备 Token" },
  { to: "/usage", label: "用量" },
  { to: "/settings", label: "设置" },
];

export default function Layout() {
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="px-4 py-4 font-semibold text-slate-800">AI Gateway</div>
        <nav className="space-y-1 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-50"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex h-14 items-center justify-end border-b border-slate-200 bg-white px-6">
          <Button variant="ghost" onClick={() => logout()}>退出登录</Button>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
