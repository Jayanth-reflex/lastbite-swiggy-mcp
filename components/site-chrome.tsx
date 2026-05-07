import Link from "next/link";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />
          Last Bite
        </Link>
        <nav className="ml-auto flex items-center gap-5 text-sm text-muted-foreground">
          <Link href="/#how-it-works" className="hover:text-foreground">
            How it works
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <a
            href="https://github.com/Jayanth-reflex/swiggy-mcp"
            target="_blank"
            rel="noreferrer"
            className="hidden hover:text-foreground sm:inline"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-12 border-t border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">Last Bite</span>
          <span>WhatsApp-native Swiggy ordering with three gates and a 30-second grace timer.</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <a
            href="https://github.com/Jayanth-reflex/swiggy-mcp"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          <a href="mailto:hello@lastbite.fun" className="hover:text-foreground">
            Support
          </a>
        </div>
      </div>
      <PoweredBySwiggy />
    </footer>
  );
}
