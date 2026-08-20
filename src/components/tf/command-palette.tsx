"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Icon } from "@/components/tf/icon";
import {
  allNavItems, canSeeItem, canSeeWorkspace, navItemById, QUICK_ACTIONS,
  type NavContext,
} from "@/lib/nav";

/**
 * Buscador global (⌘K / Ctrl+K).
 *
 * Mantiene el sidebar limpio sin sacrificar descubribilidad: encuentra cualquier
 * módulo aunque esté en otro workspace, y recuerda los últimos visitados para
 * que quien trabaja siempre en las mismas pantallas llegue en dos teclas.
 */

const RECENTS_KEY = "tf:recent-modules";
const MAX_RECENTS = 5;

/** Registra una visita. La llama el panel contextual al navegar. */
export function rememberVisit(id: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[palette] no se pudo guardar el módulo reciente:", err);
  }
}

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch (err) {
    console.error("[palette] no se pudieron leer los módulos recientes:", err);
    return [];
  }
}

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("tf:open-palette"));
}

export function CommandPalette({
  role, modules, companyType,
}: {
  role?: string;
  modules?: string[] | null;
  companyType?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const ctx: NavContext = { role, modules, companyType };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("tf:open-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("tf:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setRecents(readRecents());
  }, [open]);

  const go = (href: string, id?: string) => {
    setOpen(false);
    if (id) rememberVisit(id);
    router.push(href);
  };

  const entries = allNavItems().filter(
    ({ workspace, item }) => canSeeWorkspace(workspace, ctx) && canSeeItem(item, ctx)
  );

  const recentEntries = recents
    .map((id) => navItemById(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .filter(({ workspace, item }) => canSeeWorkspace(workspace, ctx) && canSeeItem(item, ctx));

  const quick = QUICK_ACTIONS.filter((a) => canSeeItem(a, ctx));

  // Agrupado por workspace, respetando el orden del riel.
  const byWorkspace = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = byWorkspace.get(entry.workspace.id) || [];
    list.push(entry);
    byWorkspace.set(entry.workspace.id, list);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Buscar en el sistema"
      description="Encuentra cualquier módulo, esté en el workspace que esté."
    >
      <CommandInput placeholder="Buscar módulo, reporte o acción…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>Sin resultados.</CommandEmpty>

        {quick.length > 0 && (
          <CommandGroup heading="Acciones rápidas">
            {quick.map((action) => (
              <CommandItem
                key={action.id}
                value={`accion ${action.label} ${action.description}`}
                onSelect={() => go(action.href)}
              >
                <Icon name={action.icon} className="mr-2 size-4 text-primary" />
                <span className="font-medium">{action.label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{action.description}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {recentEntries.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recientes">
              {recentEntries.map(({ workspace, item }) => (
                <CommandItem
                  key={`recent-${item.id}`}
                  value={`reciente ${item.label} ${workspace.label}`}
                  onSelect={() => go(item.href, item.id)}
                >
                  <Icon name={item.icon} className="mr-2 size-4" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{workspace.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {[...byWorkspace.entries()].map(([workspaceId, items]) => {
          const workspace = items[0].workspace;
          return (
            <CommandGroup key={workspaceId} heading={workspace.label}>
              {items.map(({ group, item }) => (
                <CommandItem
                  key={item.id}
                  value={[workspace.label, group.title, item.label, item.description, ...(item.keywords || [])].join(" ")}
                  onSelect={() => go(item.href, item.id)}
                >
                  <Icon name={item.icon} className="mr-2 size-4" />
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto truncate pl-3 text-[11px] text-muted-foreground">
                    {group.title}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
