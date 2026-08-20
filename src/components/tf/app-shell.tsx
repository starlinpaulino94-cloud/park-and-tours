"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import {
  breadcrumbs, canSeeItem, visibleGroups, visibleWorkspaces, workspaceOf, workspaceLanding,
  QUICK_ACTIONS, type NavContext, type Workspace, type BadgeKey,
} from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { api } from "@/lib/api";
import { signOut as authSignOut } from "@/lib/auth-client";
import { toast } from "sonner";
import { CommandPalette, openCommandPalette, rememberVisit } from "@/components/tf/command-palette";
import { OrgProvider, useOrg } from "@/components/tf/org-context";
import { COMPANY_TYPE } from "@/lib/labels";

export type NavBadges = Partial<Record<BadgeKey, number>>;

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

const NAV_MODE_KEY = "tf:nav-mode";
type NavMode = "full" | "compact";

/* -------------------------------------------------------------------------- */
/* Respuesta inmediata al clic                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cada pantalla se renderiza en el servidor, así que entre el clic y el cambio
 * de página pasa un tiempo real. Sin señal alguna, esa espera se lee como una
 * app colgada. Aquí se marca la entrada pulsada y se pinta una barra de avance
 * hasta que la ruta cambia.
 */
const NavPendingContext = createContext<{ pending: string | null; start: (href: string) => void }>({
  pending: null,
  start: () => {},
});

function useNavPending() {
  return useContext(NavPendingContext);
}

/* -------------------------------------------------------------------------- */
/* Nivel 1 — riel de workspaces. Diez entradas, nunca crece.                   */
/* -------------------------------------------------------------------------- */

function WorkspaceLink({
  workspace, href, active, compact, badge, onNavigate,
}: {
  workspace: Workspace;
  /** Módulo de entrada del área, no una pantalla intermedia de tarjetas. */
  href: string;
  active: boolean;
  compact: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const { start } = useNavPending();
  return (
    <Link
      href={href}
      prefetch
      onClick={() => { start(href); onNavigate?.(); }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-xl transition-colors",
        compact
          ? "size-11 justify-center"
          : "w-[66px] flex-col gap-1 px-1 py-2",
        active
          ? "bg-sidebar-accent text-sidebar-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
      )}
      <span className="relative">
        <Icon name={workspace.icon} className="size-[18px]" />
        {!!badge && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 grid min-w-[15px] place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-[15px] text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {!compact && (
        <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">
          {workspace.short}
        </span>
      )}
    </Link>
  );
}

function WorkspaceRail({
  ctx, active, mode, badges, onToggleMode, onNavigate,
}: {
  ctx: NavContext;
  active: Workspace;
  mode: NavMode;
  badges: NavBadges;
  onToggleMode?: () => void;
  onNavigate?: () => void;
}) {
  const workspaces = visibleWorkspaces(ctx);
  const main = workspaces.filter((w) => !w.footer);
  const bottom = workspaces.filter((w) => w.footer);
  const compact = mode === "compact";

  const badgeOf = (w: Workspace) =>
    visibleGroups(w, ctx)
      .flatMap((g) => g.items)
      .reduce((sum, i) => sum + (i.badgeKey ? badges[i.badgeKey] || 0 : 0), 0);

  const render = (w: Workspace) => {
    const link = (
      <WorkspaceLink
        workspace={w}
        href={workspaceLanding(w, ctx)}
        active={w.id === active.id}
        compact={compact}
        badge={badgeOf(w)}
        onNavigate={onNavigate}
      />
    );
    if (!compact) {
      return (
        <Tooltip key={w.id}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-[220px]">
            <p className="font-semibold">{w.label}</p>
            <p className="text-[11px] opacity-80">{w.tagline}</p>
          </TooltipContent>
        </Tooltip>
      );
    }
    // Contraído: el clic sigue navegando y el árbol del workspace aparece al
    // posarse encima, así ganar espacio de trabajo nunca cuesta perder el
    // nivel 2 ni obliga a competir por el mismo clic.
    return (
      <HoverCard key={w.id} openDelay={140} closeDelay={120}>
        <HoverCardTrigger asChild>{link}</HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[252px] border-sidebar-border bg-sidebar p-0"
        >
          <ContextPanel ctx={ctx} workspace={w} badges={badges} flyout />
        </HoverCardContent>
      </HoverCard>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <nav
        aria-label="Áreas del sistema"
        className={cn(
          "flex h-full shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3",
          compact ? "w-[64px]" : "w-[78px]"
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="mb-2 grid size-10 shrink-0 place-items-center rounded-xl bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground"
          aria-label="Inicio"
        >
          T
        </Link>

        <div className="tf-scroll flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {main.map(render)}
        </div>

        <div className="flex w-full flex-col items-center gap-0.5 border-t border-sidebar-border pt-2">
          {bottom.map(render)}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/profile"
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-center rounded-xl text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  compact ? "size-11" : "w-[66px] flex-col gap-1 px-1 py-2"
                )}
              >
                <Icon name="CircleUser" className="size-[18px]" />
                {!compact && <span className="text-[10px] font-semibold">Perfil</span>}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Mi perfil</TooltipContent>
          </Tooltip>
          {onToggleMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleMode}
                  aria-label={compact ? "Expandir navegación" : "Contraer navegación"}
                  className="mt-1 hidden size-9 place-items-center rounded-xl text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground lg:grid"
                >
                  <Icon name={compact ? "PanelLeftOpen" : "PanelLeftClose"} className="size-[17px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {compact ? "Expandir navegación" : "Contraer para ganar espacio"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </nav>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Contexto organizacional — empresa y sucursal activa                        */
/* -------------------------------------------------------------------------- */

function OrgHeader({ compactLabel }: { compactLabel?: boolean }) {
  const { companyName, companyType, branches, branch, setBranchId } = useOrg();
  const typeLabel = companyType ? COMPANY_TYPE[companyType]?.label : undefined;

  return (
    <div className="border-b border-sidebar-border px-3 py-3">
      <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-2.5 py-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
          {initials(companyName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-sidebar-foreground">
            {companyName}
          </p>
          {typeLabel && !compactLabel && (
            <p className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
              {typeLabel}
            </p>
          )}
        </div>
      </div>

      {branches.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/50">
              <Icon name="Building2" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {branch ? branch.name : "Todas las sucursales"}
              </span>
              <Icon name="ChevronsUpDown" className="size-3.5 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">
              Sucursal activa
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setBranchId(null)}>
              <Icon name="Globe" className="mr-2 size-4" /> Todas las sucursales
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {branches.map((b) => (
              <DropdownMenuItem key={b._id} onClick={() => setBranchId(b._id)}>
                <Icon name="Building2" className="mr-2 size-4" />
                <span className="truncate">{b.name}</span>
                {branch?._id === b._id && <Icon name="Check" className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nivel 2 — el árbol del workspace en el que estás                            */
/* -------------------------------------------------------------------------- */

function ContextPanel({
  ctx, workspace, badges, onNavigate, flyout = false, showOrg = false,
}: {
  ctx: NavContext;
  workspace: Workspace;
  badges: NavBadges;
  onNavigate?: () => void;
  flyout?: boolean;
  showOrg?: boolean;
}) {
  const pathname = usePathname();
  const groups = visibleGroups(workspace, ctx);
  const { pending, start } = useNavPending();

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {showOrg && <OrgHeader />}

      {/*
        Sin bloque descriptivo del workspace: el riel ya marca el área activa y
        las migas la repiten en la cabecera. Repetir nombre y descripción aquí
        solo robaba altura al menú, que es lo que de verdad se usa.
        En el flyout del riel contraído sí hace falta un título, porque ahí el
        nivel 1 son iconos sueltos.
      */}
      {flyout && (
        <div className="flex items-center gap-2 border-b border-sidebar-border px-3.5 py-2.5">
          <Icon name={workspace.icon} className="size-4 shrink-0 text-sidebar-primary" />
          <p className="truncate text-[13px] font-semibold text-sidebar-foreground">{workspace.label}</p>
        </div>
      )}

      <nav
        aria-label={`Navegación de ${workspace.label}`}
        className={cn("tf-scroll flex-1 space-y-4 overflow-y-auto px-3 pb-5 pt-3", flyout && "max-h-[70vh] pt-2")}
      >
        {groups.map((group) => (
          <div key={group.id}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/50">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                const count = item.badgeKey ? badges[item.badgeKey] || 0 : 0;
                const loading = pending === item.href && !active;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      prefetch
                      onClick={() => {
                        rememberVisit(item.id);
                        if (!item.external) start(item.href);
                        onNavigate?.();
                      }}
                      target={item.external ? "_blank" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                        active || loading
                          ? "bg-sidebar-accent text-sidebar-primary"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon
                        name={item.icon}
                        className={cn("size-4 shrink-0", active && "text-sidebar-primary")}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.tag && (
                        <span className="rounded bg-sidebar-primary/25 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-brand-100">
                          {item.tag}
                        </span>
                      )}
                      {count > 0 && (
                        <span className="ml-auto grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                      {item.external && <Icon name="ArrowUpRight" className="ml-auto size-3.5 opacity-60" />}
                      {loading && (
                        <Icon name="LoaderCircle" className="ml-auto size-3.5 animate-spin text-sidebar-primary" />
                      )}
                      {active && !loading && !count && !item.external && (
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

      {!flyout && (
        <div className="border-t border-sidebar-border p-3">
          {ctx.role === "superadmin" && (
            <Link
              href="/superadmin"
              onClick={onNavigate}
              className="mb-2 flex items-center gap-2 rounded-lg bg-sidebar-accent/60 px-3 py-2 text-[12px] font-semibold text-sidebar-primary hover:bg-sidebar-accent"
            >
              <Icon name="Globe2" className="size-4" /> Panel de plataforma
            </Link>
          )}
          <button
            onClick={openCommandPalette}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <Icon name="LifeBuoy" className="size-4" /> Ayuda y búsqueda
            <kbd className="ml-auto rounded border border-sidebar-border px-1.5 text-[10px] font-semibold">⌘K</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navegación móvil — dos pasos: workspaces → módulos del workspace            */
/* -------------------------------------------------------------------------- */

function MobileNav({
  ctx, current, badges, onNavigate,
}: {
  ctx: NavContext;
  current: Workspace;
  badges: NavBadges;
  onNavigate: () => void;
}) {
  const [selected, setSelected] = useState<Workspace | null>(null);
  const workspaces = visibleWorkspaces(ctx);

  if (selected) {
    return (
      <div className="flex h-full w-full flex-col bg-sidebar">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3 text-[13px] font-semibold text-sidebar-foreground/80"
        >
          <Icon name="ChevronLeft" className="size-4" /> Todas las áreas
        </button>
        <div className="min-h-0 flex-1">
          <ContextPanel ctx={ctx} workspace={selected} badges={badges} onNavigate={onNavigate} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <OrgHeader />
      <ul className="tf-scroll flex-1 overflow-y-auto p-3">
        {workspaces.map((w) => {
          const count = visibleGroups(w, ctx)
            .flatMap((g) => g.items)
            .reduce((sum, i) => sum + (i.badgeKey ? badges[i.badgeKey] || 0 : 0), 0);
          return (
            <li key={w.id}>
              <button
                onClick={() => setSelected(w)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  w.id === current.id
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                )}
              >
                <Icon name={w.icon} className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{w.label}</span>
                  <span className="block truncate text-[11px] text-sidebar-foreground/60">{w.tagline}</span>
                </span>
                {count > 0 && (
                  <span className="grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {count}
                  </span>
                )}
                <Icon name="ChevronRight" className="size-4 shrink-0 opacity-50" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function AppShell({
  user, badges = {}, children,
}: {
  user: ShellUser;
  badges?: NavBadges;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<NavMode>("full");

  const [pending, setPending] = useState<string | null>(null);

  const ctx: NavContext = { role: user.role, modules: user.modules, companyType: user.companyType };
  const workspace = workspaceOf(pathname);
  // La primera miga lleva al módulo de entrada del área: el workspace en sí no
  // es una pantalla, así se evita el salto por la redirección.
  const trail = breadcrumbs(pathname).map((crumb, i) =>
    i === 0 ? { ...crumb, href: workspaceLanding(workspace, ctx) } : crumb
  );

  // Al llegar la nueva ruta se apaga el indicador. La red de seguridad evita que
  // una navegación fallida deje la barra encendida para siempre.
  useEffect(() => { setPending(null); }, [pathname]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      console.warn(`[shell] la navegación a ${pending} tarda más de lo previsto`);
      setPending(null);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const startNav = useCallback((href: string) => {
    setPending((prev) => (href === window.location.pathname ? prev : href));
  }, []);

  // La preferencia de sidebar se recuerda entre sesiones.
  useEffect(() => {
    const stored = window.localStorage.getItem(NAV_MODE_KEY);
    if (stored === "compact" || stored === "full") setMode(stored);
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "full" ? "compact" : "full";
      window.localStorage.setItem(NAV_MODE_KEY, next);
      return next;
    });
  }, []);

  const quickActions = QUICK_ACTIONS.filter((a) => canSeeItem(a, ctx));

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
      console.error("[shell] error saliendo de la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo salir de la empresa");
      return;
    }
    toast.success("Has salido de la empresa");
    router.push("/superadmin");
    router.refresh();
  };

  return (
    <NavPendingContext.Provider value={{ pending, start: startNav }}>
    <OrgProvider companyName={user.companyName} companyType={user.companyType}>
      <div className="flex min-h-screen bg-background">
        {/* Señal de que el clic se registró, mientras el servidor prepara la pantalla. */}
        {pending && (
          <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent">
            <div className="tf-nav-progress h-full w-full origin-left bg-primary" />
          </div>
        )}
        <CommandPalette role={user.role} modules={user.modules} companyType={user.companyType} />

        {/* Nivel 1 + nivel 2. En compacto el panel se pliega y el árbol vive en el flyout del riel. */}
        <div className="sticky top-0 hidden h-screen shrink-0 lg:flex">
          <WorkspaceRail
            ctx={ctx}
            active={workspace}
            mode={mode}
            badges={badges}
            onToggleMode={toggleMode}
          />
          {mode === "full" && (
            <aside className="w-[252px] border-r border-sidebar-border">
              <ContextPanel ctx={ctx} workspace={workspace} badges={badges} showOrg />
            </aside>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                  <Icon name="Menu" className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[320px] border-sidebar-border bg-sidebar p-0">
                <SheetTitle className="sr-only">Navegación</SheetTitle>
                <MobileNav ctx={ctx} current={workspace} badges={badges} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Migas: Workspace → Grupo → Módulo. */}
            <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-[13px]">
              <Icon name={workspace.icon} className="size-4 shrink-0 text-primary" />
              {trail.map((crumb, i) => (
                <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <Icon name="ChevronRight" className="size-3.5 shrink-0 text-muted-foreground/60" />}
                  {i === trail.length - 1 ? (
                    <span className="truncate font-semibold text-foreground">{crumb.label}</span>
                  ) : crumb.href ? (
                    <Link href={crumb.href} className="hidden truncate text-muted-foreground hover:text-foreground sm:inline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="hidden truncate text-muted-foreground md:inline">{crumb.label}</span>
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
                Buscar
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold">⌘K</kbd>
              </button>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Buscar" onClick={openCommandPalette}>
                <Icon name="Search" className="size-4" />
              </Button>

              {/* Las acciones frecuentes son acciones, no módulos: viven aquí. */}
              {quickActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="gap-1.5 rounded-full px-3 sm:px-4">
                      <Icon name="Plus" className="size-4" />
                      <span className="hidden sm:inline">Crear</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">
                      Acciones rápidas
                    </DropdownMenuLabel>
                    {quickActions.map((action) => (
                      <DropdownMenuItem key={action.id} asChild>
                        <Link href={action.href}>
                          <Icon name={action.icon} className="mr-2 size-4" />
                          <span>{action.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                    <Link href="/profile">
                      <Icon name="CircleUser" className="mr-2 size-4" /> Mi perfil
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/configuracion">
                      <Icon name="Settings" className="mr-2 size-4" /> Configuración
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
    </OrgProvider>
    </NavPendingContext.Provider>
  );
}
