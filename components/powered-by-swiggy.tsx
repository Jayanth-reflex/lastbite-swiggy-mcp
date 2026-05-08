import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "footer" | "inline";
}

/**
 * Powered by Swiggy attribution. CLAUDE.md: must appear on every screen
 * surfacing Swiggy data. Never restyle to be hidden, faded, or below the
 * fold without an alternate visible badge.
 */
export function PoweredBySwiggy({ className, variant = "footer" }: Props) {
  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-muted",
          className,
        )}
      >
        <SwiggyDot />
        Powered by Swiggy
      </span>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <SwiggyDot />
      <span>Powered by Swiggy</span>
    </div>
  );
}

function SwiggyDot() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-1.5 rounded-full bg-brand"
    />
  );
}
