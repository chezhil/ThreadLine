import { TextareaHTMLAttributes, forwardRef } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = "", id, rows = 3, ...props }, ref) => {
    const textareaId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={textareaId} className="label-caps text-gray-600">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={`rounded-md border bg-white px-3 py-2 text-sm text-foreground shadow-2xs outline-none transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-brand-tint focus:ring-2 focus:ring-brand-tint/20 disabled:bg-surface-low disabled:text-gray-500 ${
            error ? "border-red-500" : "border-border-strong/80"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error && textareaId ? `${textareaId}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={textareaId ? `${textareaId}-error` : undefined} className="text-xs font-medium text-red-700">
            {error}
          </span>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
