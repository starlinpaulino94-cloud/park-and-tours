"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/tf/icon";
import { DOMAINS, canSeeModule, canSeeDomain, type Domain, type ModuleNode } from "@/lib/nav";

/**
 * ⌘K / Ctrl+K palette. With 13 domains and ~80 modules, jumping straight to a
 * module matters more than clicking through the tree, so the palette indexes
 * every module the current user is allowed to reach.
 */
export function CommandPalette({
  role, modules, companyType,
}: {
  role?: string;
  modules?: string[] | null;
  companyType?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("tf:open-palette", onOpen);
    return () => window.removeEventListener("tf:open-palette", onOpen);
  }, []);

  const groups = useMemo(() => {
    const out: { domain: Domain; items: ModuleNode[] }[] = [];
    for (const domain of DOMAINS) {
      if (!canSeeDomain(domain, role, modules, companyType)) continue;
      const items = domain.sections
        .flatMap((s) => s.items)
        .filter((i) => canSeeModule(i, role, modules, companyType));
      if (items.length > 0) out.push({ domain, items });
    }
    return out;
  }, [role, modules, companyType]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Buscar en el sistema"
      description="Salta a cualquier módulo"
      className="max-w-2xl"
    >
      <CommandInput placeholder="Buscar módulo, pantalla o acción…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {groups.map(({ domain, items }) => (
          <CommandGroup key={domain.slug} heading={domain.label}>
            {items.map((item) => (
              <CommandItem
                key={item.href}
                value={`${domain.label} ${item.label} ${item.description}`}
                onSelect={() => go(item.href)}
              >
                <Icon name={item.icon} className="size-4 text-muted-foreground" />
                <span className="font-medium">{item.label}</span>
                <span className="ml-auto truncate pl-4 text-[11px] text-muted-foreground">
                  {domain.label}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Opens the palette from anywhere (header button, empty states, hub pages). */
export function openCommandPalette() {
  window.dispatchEvent(new Event("tf:open-palette"));
}
