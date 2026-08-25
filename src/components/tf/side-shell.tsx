"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import type { NavItem } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { signOut as authSignOut } from "@/lib/auth-client";
import { toast } from "sonner";

/**
 * Lighter shell shared by the B2B portal and the platform panel. Both are flat
 * single-level navigations, so they do not need the grouped ERP sidebar.
 */
export function SideShell({
  nav, brand, subtitle, badge, accent = "primary", user, extraLinks, children,
}: {
  nav: NavItem[];
  brand: string;
  subtitle: string;
  badge?: string;
  accent?: "primary" | "ink";
  /** Identidad visible del usuario. Sin correo: solo `/dashboard/perfil` lo muestra. */
  user: { name: string; role: string; companyName?: string };
  extraLinks?: { href: string; label: string; icon: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await authSignOut();
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("[side-shell] error cerrando sesión:", err);
      toast.error("No se pudo cerrar la sesión");
    } finally {
      setBusy(false);
    }
  };

  const links = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto tf-scroll px-3 pb-6">
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== nav[0].href && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Icon name={item.icon} className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
            <span className="truncate">{item.label}</span>
            {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
          </Link>
        );
      })}
      {extraLinks && extraLinks.length > 0 && (
        <div className="mt-5 border-t border-sidebar-border pt-4">
          {extraLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            >
              <Icon name={l.icon} className="size-4 shrink-0" /> {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );

  const brandBlock = (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <span className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl font-display text-base font-bold",
        accent === "ink"
          ? "bg-ink text-sand"
          : "bg-sidebar-primary text-sidebar-primary-foreground"
      )}>
        T
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-display text-[15px] font-semibold leading-none text-sidebar-foreground">
          {brand}
          {badge && (
            <span className="rounded bg-sidebar-primary/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-sidebar-primary">
              {badge}
            </span>
          )}
        </p>
        <p className="mt-1 truncate text-[11px] text-sidebar-foreground/70">{subtitle}</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {brandBlock}
        {links()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                <Icon name="Menu" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] border-sidebar-border bg-sidebar p-0">
              <SheetTitle className="sr-only">Navegación</SheetTitle>
              {brandBlock}
              {links(() => setOpen(false))}
            </SheetContent>
          </Sheet>

          <p className="truncate font-display text-sm font-semibold sm:text-base">{subtitle}</p>

          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 transition-colors hover:bg-muted">
                  <span className="grid size-7 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-[12px] font-semibold leading-none">{user.name}</span>
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{user.role}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{user.role}</p>
                  {user.companyName && <p className="mt-1 text-[11px] text-muted-foreground">{user.companyName}</p>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {extraLinks?.map((l) => (
                  <DropdownMenuItem key={l.href} asChild>
                    <Link href={l.href}><Icon name={l.icon} className="mr-2 size-4" /> {l.label}</Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} disabled={busy}>
                  <Icon name="LogOut" className="mr-2 size-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
