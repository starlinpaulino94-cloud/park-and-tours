import { Suspense } from "react";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { parseFilter } from "@/lib/my-day";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import {
  ApprovalsSection, Counters, ListSkeleton, TasksSection, TilesSkeleton,
} from "./_components/sections";

/**
 * Centro de trabajo operativo del usuario.
 *
 * Tres niveles: contadores exactos, tareas priorizadas y decisiones que le
 * corresponden. Cada nivel se carga por separado, así que un fallo en
 * aprobaciones no impide ver las tareas ni al revés. Ninguna acción financiera
 * se ejecuta al renderizar: aprobar, rechazar y completar son mutaciones
 * explícitas, confirmadas y reautorizadas en el servidor.
 *
 * El encabezado es solo el nombre del módulo: sin eyebrow, sin saludo, sin
 * nombre ni correo del usuario y sin descripción.
 */
export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireTenant();
  const filter = parseFilter((await searchParams).f);

  // Superadministrador sin empresa suplantada: mismo título, sin saludo.
  if (ctx.role === "superadmin" && !ctx.impersonating) {
    return (
      <div className="space-y-5">
        <PageHeader title="Mi día" />
        <EmptyState
          icon="Globe2"
          title="Panel de plataforma activo"
          description="Las tareas y aprobaciones pertenecen a cada empresa. Entra a una para ver sus pendientes."
          action={
            <Link href="/superadmin" className="text-sm font-semibold text-primary hover:underline">
              Ir a superadmin
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Mi día" />

      <Suspense fallback={<TilesSkeleton />}>
        <Counters ctx={ctx} filter={filter} />
      </Suspense>

      <Suspense fallback={<ListSkeleton title="Tareas prioritarias" rows={4} />}>
        <TasksSection ctx={ctx} filter={filter} />
      </Suspense>

      <Suspense fallback={<ListSkeleton title="Aprobaciones pendientes" rows={2} />}>
        <ApprovalsSection ctx={ctx} />
      </Suspense>
    </div>
  );
}
