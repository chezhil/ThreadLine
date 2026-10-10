import { SelectHTMLAttributes, forwardRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className = "", id, ...props }, ref) => {
    const selectId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="label-caps text-gray-600">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`rounded-md border bg-white px-3 py-2 text-sm text-foreground shadow-2xs outline-none transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-brand-tint focus:ring-2 focus:ring-brand-tint/20 disabled:bg-surface-low disabled:text-gray-500 ${
            error ? "border-red-500" : "border-border-strong/80"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error && selectId ? `${selectId}-error` : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <span id={selectId ? `${selectId}-error` : undefined} className="text-xs font-medium text-red-700">
            {error}
          </span>
        )}
      </div>
    );
  },
);
Select.displayName = "Select";
