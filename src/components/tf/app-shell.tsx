"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import {
  breadcrumbs, canSeeModule, domainOf, visibleDomains, visibleSections,
  type Domain,
} from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { api } from "@/lib/api";
import { signOut as authSignOut } from "@/lib/auth-client";
import { toast } from "sonner";
import { CommandPalette, openCommandPalette } from "@/components/tf/command-palette";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  companyName: string;
  companyType?: string;
  modules?: string[] | null;
  impersonating?: boolean;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Level 1 — the domain rail. Fixed at 13 entries, so it never grows.          */
/* -------------------------------------------------------------------------- */

function DomainRail({ user, active }: { user: ShellUser; active: Domain }) {
  const domains = visibleDomains(user.role, user.modules, user.companyType);
  return (
    <TooltipProvider delayDuration={120}>
      <nav
        aria-label="Áreas del sistema"
        className="flex h-full w-[78px] shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3"
      >
        <Link
          href="/dashboard"
          className="mb-2 grid size-10 place-items-center rounded-xl bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground"
          aria-label="Inicio"
        >
          T
        </Link>
        <div className="tf-scroll flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {domains.map((d) => {
            const isActive = d.slug === active.slug;
            return (
              <Tooltip key={d.slug}>
                <TooltipTrigger asChild>
                  <Link
                    href={d.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex w-[66px] flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                    )}
                    <Icon name={d.icon} className="size-[18px]" />
                    <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">
                      {d.short}
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px]">
                  <p className="font-semibold">{d.label}</p>
                  <p className="text-[11px] opacity-80">{d.tagline}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Level 2 — the module tree of the domain you are inside.                     */
/* -------------------------------------------------------------------------- */

function DomainPanel({
  user, domain, onNavigate,
}: {
  user: ShellUser;
  domain: Domain;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = visibleSections(domain, user.role, user.modules, user.companyType);
  const hubActive = pathname === domain.href;

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="px-4 pb-3 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sidebar-foreground/55">
          Área
        </p>
        <div className="mt-1 flex items-start gap-2">
          <Icon name={domain.icon} className="mt-0.5 size-[17px] shrink-0 text-sidebar-primary" />
          <div className="min-w-0">
            <p className="font-display text-[15px] font-semibold leading-tight text-sidebar-foreground">
              {domain.label}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-sidebar-foreground/65">{domain.tagline}</p>
          </div>
        </div>
      </div>

      {domain.slug !== "inicio" && (
        <div className="px-3 pb-2">
          <Link
            href={domain.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors",
              hubActive
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Icon name="LayoutGrid" className="size-4" />
            Resumen del área
          </Link>
        </div>
      )}

      <nav className="tf-scroll flex-1 space-y-4 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/50">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-primary"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon
                        name={item.icon}
                        className={cn("size-4 shrink-0", active && "text-sidebar-primary")}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto rounded bg-sidebar-primary/25 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-brand-100">
                          {item.badge}
                        </span>
                      )}
                      {active && !item.badge && (
                        <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {user.role === "superadmin" && (
          <Link
            href="/superadmin"
            onClick={onNavigate}
            className="mb-2 flex items-center gap-2 rounded-lg bg-sidebar-accent/60 px-3 py-2 text-[12px] font-semibold text-sidebar-primary hover:bg-sidebar-accent"
          >
            <Icon name="Globe2" className="size-4" /> Panel de plataforma
          </Link>
        )}
        <p className="px-3 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
          {user.subscriptionStatus === "trial" ? "Periodo de prueba" : "Suscripción activa"}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const domain = domainOf(pathname);
  const trail = breadcrumbs(pathname);
  const showPos = canSeeModule(
    { href: "/dashboard/pos", label: "", icon: "", description: "" },
    user.role, user.modules, user.companyType
  );

  const signOut = async () => {
    setBusy(true);
    try {
      await authSignOut();
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("[shell] error cerrando sesión:", err);
      toast.error("No se pudo cerrar la sesión");
    } finally {
      setBusy(false);
    }
  };

  const stopImpersonation = async () => {
    const res = await api.post("/api/superadmin/impersonate", { stop: true });
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo salir de la empresa");
      return;
    }
    toast.success("Has salido de la empresa");
    router.push("/superadmin");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen bg-background">
      <CommandPalette role={user.role} modules={user.modules} companyType={user.companyType} />

      {/* Two-level navigation: domain rail + the module tree of that domain. */}
      <div className="sticky top-0 hidden h-screen shrink-0 lg:flex">
        <DomainRail user={user} active={domain} />
        <aside className="w-[248px] border-r border-sidebar-border">
          <DomainPanel user={user} domain={domain} />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                <Icon name="Menu" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[330px] border-sidebar-border bg-sidebar p-0">
              <SheetTitle className="sr-only">Navegación</SheetTitle>
              <DomainRail user={user} active={domain} />
              <div className="min-w-0 flex-1">
                <DomainPanel user={user} domain={domain} onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Breadcrumbs make the nesting explicit: area → module. */}
          <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <Icon name={domain.icon} className="size-4 shrink-0 text-primary" />
            {trail.map((crumb, i) => (
              <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <Icon name="ChevronRight" className="size-3.5 shrink-0 text-muted-foreground/60" />}
                {i === trail.length - 1 ? (
                  <span className="truncate font-semibold text-foreground">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="truncate text-muted-foreground hover:text-foreground">
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openCommandPalette}
              className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted md:flex"
            >
              <Icon name="Search" className="size-3.5" />
              Buscar módulo
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold">⌘K</kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Buscar"
              onClick={openCommandPalette}
            >
              <Icon name="Search" className="size-4" />
            </Button>

            {showPos && (
              <Link href="/dashboard/pos" className="hidden sm:block">
                <Button size="sm" className="gap-1.5 rounded-full px-4">
                  <Icon name="Plus" className="size-4" /> Nueva venta
                </Button>
              </Link>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 transition-colors hover:bg-muted">
                  <span className="grid size-7 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-[12px] font-semibold leading-none">{user.name}</span>
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                      {user.role}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{user.companyName}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/inicio/mi-dia">
                    <Icon name="Sun" className="mr-2 size-4" /> Mi día
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/configuracion">
                    <Icon name="Settings" className="mr-2 size-4" /> Configuración
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/portal">
                    <Icon name="Handshake" className="mr-2 size-4" /> Portal B2B
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} disabled={busy}>
                  <Icon name="LogOut" className="mr-2 size-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {user.impersonating && (
          <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-[13px] text-amber-950 sm:px-6 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
            <Icon name="Eye" className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">
              Estás operando dentro de <strong>{user.companyName}</strong> como superadministrador.
              Todas las acciones quedan registradas en la auditoría.
            </p>
            <Button size="sm" variant="outline" className="h-7 border-amber-500 bg-transparent" onClick={stopImpersonation}>
              Salir
            </Button>
          </div>
        )}

        <div className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
