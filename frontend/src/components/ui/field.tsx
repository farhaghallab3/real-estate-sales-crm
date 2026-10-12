import clsx from "clsx";
import { forwardRef } from "react";

const control =
  "w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 " +
  "transition-colors hover:border-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 " +
  "disabled:bg-canvas disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(control, "h-9", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(control, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={clsx(control, "py-2", className)} {...rest} />;
  },
);

export function Field({
  label,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-muted">
        {label}
        {required && <span className="text-bad-fg"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-2xs text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-bad-fg">
          {error}
        </span>
      )}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-bad-fg/20 bg-bad-bg px-3 py-2 text-xs text-bad-fg">
      {message}
    </div>
  );
}
