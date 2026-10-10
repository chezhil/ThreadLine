import { InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="label-caps text-gray-600">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`rounded-md border bg-white px-3 py-2 text-sm text-foreground shadow-2xs outline-none transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-brand-tint focus:ring-2 focus:ring-brand-tint/20 disabled:bg-surface-low disabled:text-gray-500 ${
            error ? "border-red-500" : "border-border-strong/80"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error && inputId ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={inputId ? `${inputId}-error` : undefined} className="text-xs font-medium text-red-700">
            {error}
          </span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
