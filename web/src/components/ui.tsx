import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, ButtonHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {title ? <div className="px-4 py-3 border-b border-slate-100 font-medium text-slate-700">{title}</div> : null}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Button({ children, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "secondary" }) {
  const cls =
    variant === "primary"
      ? "bg-blue-600 hover:bg-blue-700 text-white"
      : variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "secondary"
      ? "bg-slate-100 hover:bg-slate-200 text-slate-700"
      : "bg-transparent hover:bg-slate-100 text-slate-600";
  return (
    <button
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none ${className}`} {...props} />;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "green" | "red" | "slate" | "blue"; children: ReactNode }) {
  const tones = {
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-100 text-blue-700",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Empty({ text = "暂无数据" }: { text?: string }) {
  return <div className="py-10 text-center text-slate-400">{text}</div>;
}

export function Spinner() {
  return <div className="flex items-center justify-center py-10 text-slate-400">加载中…</div>;
}
