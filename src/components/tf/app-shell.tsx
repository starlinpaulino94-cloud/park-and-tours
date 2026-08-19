"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import { NAV, canSee } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { api } from "@/lib/api";
import { signOut as authSignOut } from "@/lib/auth-client";
import { toast } from "sonner";

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

function NavLinks({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto tf-scroll px-3 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => canSee(i, user.role, user.modules));
        if (items.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-sidebar-foreground/45">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
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
                      <Icon name={item.icon} className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto rounded bg-sidebar-primary/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-sidebar-primary">
                          {item.badge}
                        </span>
                      )}
                      {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ company }: { company: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">
        T
      </span>
      <div className="min-w-0">
        <p className="font-display text-[15px] font-semibold leading-none text-sidebar-foreground">TourFlow</p>
        <p className="mt-1 truncate text-[11px] text-sidebar-foreground/55">{company}</p>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
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
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand company={user.companyName} />
        <NavLinks user={user} />
        <div className="border-t border-sidebar-border p-3">
          {user.role === "superadmin" && (
            <Link
              href="/superadmin"
              className="mb-2 flex items-center gap-2 rounded-lg bg-sidebar-accent/60 px-3 py-2 text-[12px] font-semibold text-sidebar-primary hover:bg-sidebar-accent"
            >
              <Icon name="Globe2" className="size-4" /> Panel de plataforma
            </Link>
          )}
          <p className="px-3 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
            {user.subscriptionStatus === "trial" ? "Periodo de prueba" : "Suscripción activa"}
          </p>
        </div>
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
              <Brand company={user.companyName} />
              <NavLinks user={user} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <Link href="/dashboard/pos" className="hidden sm:block">
            <Button size="sm" className="gap-1.5 rounded-full px-4">
              <Icon name="Plus" className="size-4" /> Nueva venta
            </Button>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/dashboard/checkin">
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                <Icon name="ScanLine" className="size-4" />
                <span className="hidden sm:inline">Check-in</span>
              </Button>
            </Link>
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
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
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
              Estás operando dentro de <strong>{user.companyName}</strong> como superadministrador. Todas las acciones quedan registradas en la auditoría.
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
