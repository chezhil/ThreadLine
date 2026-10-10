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
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 ${
            error ? "border-red-400" : "border-border"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error && inputId ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={inputId ? `${inputId}-error` : undefined} className="text-xs text-red-600">
            {error}
          </span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
