import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-brand-foreground hover:bg-brand-container border-brand shadow-xs",
  secondary: "bg-white text-foreground hover:bg-surface-low hover:border-gray-400 border-border-strong/70 shadow-xs",
  danger: "bg-red-700 text-white hover:bg-red-800 border-red-700 shadow-xs",
  ghost: "bg-transparent text-gray-700 hover:bg-surface-container hover:text-foreground border-transparent",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs min-h-7",
  md: "px-3.5 py-1.5 text-[13px] min-h-9",
  lg: "px-5 py-2.5 text-sm min-h-11",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold transition-[color,background-color,border-color,transform] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
