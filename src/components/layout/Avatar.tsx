import { initials } from "./nav-config";

/** A round profile picture, or the person's initials when they have none. */
export function Avatar({
  name,
  src,
  className = "h-10 w-10 text-sm",
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a small data: URL; next/image can't optimise it
    return <img src={src} alt="" className={`shrink-0 rounded-full border border-border object-cover ${className}`} />;
  }
  return (
    <span
      className={`flex shrink-0 select-none items-center justify-center rounded-full border border-brand/20 bg-brand-soft font-display font-semibold text-brand ${className}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
