import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { IconCheck, IconClose, IconAlertTriangle, IconInfo } from "./icons";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const success = useCallback((msg: string) => showToast(msg, "success"), [showToast]);
  const error = useCallback((msg: string) => showToast(msg, "error"), [showToast]);
  const info = useCallback((msg: string) => showToast(msg, "info"), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl shadow-xl border backdrop-blur-md transition-all animate-in slide-in-from-bottom-5 duration-200 text-xs sm:text-sm font-medium ${
              toast.type === "success"
                ? "bg-emerald-50/95 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800"
                : toast.type === "error"
                ? "bg-rose-50/95 dark:bg-rose-950/90 text-rose-900 dark:text-rose-200 border-rose-200 dark:border-rose-800"
                : "bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700 shadow-slate-950/20"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {toast.type === "success" && <IconCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
              {toast.type === "error" && <IconAlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
              {toast.type === "info" && <IconInfo className="w-4 h-4 text-blue-400" />}
            </div>
            <div className="flex-1 leading-relaxed break-words">{toast.message}</div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 -mr-1 -mt-0.5 p-1 rounded-md transition-colors"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
