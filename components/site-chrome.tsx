import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 font-semibold tracking-tight"
        >
          <Logo />
          <span>Last Bite</span>
        </Link>
        <nav className="ml-auto flex items-center gap-6 text-sm text-muted-foreground">
          <Link
            href="/#how-it-works"
            className="transition-colors hover:text-foreground"
          >
            How it works
          </Link>
          <Link
            href="/privacy"
            className="transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
          <a
            href="https://github.com/Jayanth-reflex/lastbite-swiggy-mcp"
            target="_blank"
            rel="noreferrer"
            className="hidden transition-colors hover:text-foreground sm:inline"
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
    <footer className="mt-16 border-t border-border/50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Logo />
            <span>Last Bite</span>
          </Link>
          <p className="max-w-md text-sm text-muted-foreground">
            Three confirmation gates and a 30-second grace timer before any COD order goes through.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground sm:items-end">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <a
              href="https://github.com/Jayanth-reflex/lastbite-swiggy-mcp"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href="mailto:hello@lastbite.fun"
              className="transition-colors hover:text-foreground"
            >
              Support
            </a>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Powered by Swiggy
          </span>
        </div>
      </div>
    </footer>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background"
    >
      <span className="block h-2 w-2 rounded-full bg-brand" />
      <span className="absolute -inset-px rounded-md ring-1 ring-foreground/10" />
    </span>
  );
}
