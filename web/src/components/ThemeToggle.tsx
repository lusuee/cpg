import { useState, useRef, useEffect } from "react";
import { useTheme, type Theme } from "../hooks/useTheme";
import { IconSun, IconMoon, IconMonitor, IconCheck } from "./icons";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const options: Array<{ value: Theme; label: string; icon: typeof IconSun }> = [
    { value: "light", label: "浅色模式", icon: IconSun },
    { value: "dark", label: "深色模式", icon: IconMoon },
    { value: "system", label: "跟随系统", icon: IconMonitor },
  ];

  const CurrentIcon =
    theme === "system"
      ? IconMonitor
      : resolvedTheme === "dark"
      ? IconMoon
      : IconSun;

  return (
    <div className={`relative inline-block text-left ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        title={`当前主题: ${theme === "system" ? "跟随系统" : theme === "dark" ? "深色" : "浅色"}`}
        aria-label="切换主题"
      >
        <CurrentIcon className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-36 origin-top-right rounded-xl bg-white dark:bg-slate-900 shadow-lg border border-slate-200/80 dark:border-slate-800 p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTheme(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 font-semibold"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5" />
                  <span>{opt.label}</span>
                </div>
                {isSelected && <IconCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
