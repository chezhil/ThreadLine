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
          <label htmlFor={textareaId} className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={`rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40 ${
            error ? "border-red-400" : "border-border"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error && textareaId ? `${textareaId}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={textareaId ? `${textareaId}-error` : undefined} className="text-xs text-red-600">
            {error}
          </span>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
