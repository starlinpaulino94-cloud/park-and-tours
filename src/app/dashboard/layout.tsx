import { redirect } from "next/navigation";
import { getTenantContext, tenantCount, type TenantContext, esDeSocio, esDeProveedor } from "@/lib/tenant";
import { countDecidableFor } from "@/lib/approvals";
import { OPEN_TASK_STATUSES } from "@/lib/my-day";
import { inboxFilter } from "@/lib/notify";
import { AppShell, type NavBadges, type ShellUser } from "@/components/tf/app-shell";
import { ServiceWorkerRegistrar } from "@/components/tf/service-worker";

/**
 * Contadores del sidebar. Solo tres, y solo accionables: algo que alguien tiene
 * que resolver hoy. Si alguna cuenta falla no se rompe la navegación: el badge
 * simplemente no aparece.
 *
 * El de aprobaciones usa `countDecidableFor`, la misma función de dominio que
 * alimenta la tarjeta de "Mi día". Antes contaba TODAS las solicitudes
 * pendientes de la empresa con una lista de roles escrita a mano que ni
 * coincidía con `DECIDER` (un usuario `operations` veía 0 aunque tuviera
 * solicitudes que decidir) ni descontaba autoaprobaciones ni expiradas.
 */
async function loadBadges(ctx: TenantContext & { companyId: string }): Promise<NavBadges> {
  const { companyId, userId } = ctx;
  const safe = async (label: string, run: () => Promise<number>) => {
    try {
      return await Promise.race([
        run(),
        new Promise<number>((resolve) => {
          setTimeout(() => {
            console.warn(`[shell] conteo de ${label} omitido por timeout`);
            resolve(0);
          }, 1200);
        }),
      ]);
    } catch (err) {
      console.error(`[shell] no se pudo contar ${label}:`, err);
      return 0;
    }
  };

  const [tasks, approvals, incidents, notifications] = await Promise.all([
    safe("tareas", () => tenantCount(companyId, "task", {
      assigned_to: userId, status: { in: [...OPEN_TASK_STATUSES] },
    })),
    safe("aprobaciones", () => countDecidableFor(ctx)),
    safe("incidentes", () => tenantCount(companyId, "incident", {
      status: { in: ["open", "investigating", "action_required", "escalated"] },
    })),
    // Notificaciones sin leer, con EL MISMO alcance que su buzón: las suyas más
    // los avisos de empresa que le tocan por rol. Comparte `inboxFilter` con la
    // API a propósito — un contador que cuenta más de lo que la bandeja enseña
    // manda al usuario a una pantalla donde no hay nada, y a la tercera vez
    // deja de hacerle caso a la campana.
    safe("notificaciones", () => tenantCount(companyId, "notification", {
      ...inboxFilter({ userId, role: ctx.role, esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId }),
      read_status: false,
    })),
  ]);

  return { tasks, approvals, incidents, notifications };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const started = Date.now();
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");
  /**
   * LOS ACTORES DE FUERA NUNCA ENTRAN AL ERP INTERNO.
   *
   * El socio estaba desviado desde la fase 4. El PROVEEDOR no: esta línea decía
   * solo `esDeSocio`, y desde 0084 —que le dio sesión en la empresa— una cuenta de
   * transportista que escribiera `/dashboard` cargaba el armazón interno entero,
   * con su menú de finanzas, caja, comisiones y clientes.
   *
   * Los datos no salían: cada ruta y cada página de dentro lo rechazan una por
   * una, y eso está probado. Pero el armazón le enseña el mapa completo de la
   * operación de otra empresa, y el portal del proveedor nace con su guarda en el
   * layout precisamente porque «el menú no es una barrera» — la norma vale en las
   * dos direcciones.
   *
   * Se desvía a SU portal y no a `/login`: tiene sesión válida, lo que no tiene es
   * sitio aquí.
   */
  if (esDeSocio(ctx)) redirect("/portal");
  if (esDeProveedor(ctx)) redirect("/proveedor");
  // La contraseña ya está, falta el código. No se cierra la sesión: obligar a
  // escribir la contraseña otra vez es lo que empuja a desactivar el segundo
  // factor. La API lo exige por su cuenta (`requireTenant`), así que esto no es
  // la barrera: es no dejar a nadie mirando una pantalla que no va a cargar.
  if (ctx.mfaPending) redirect("/auth/verificar?next=/dashboard");

  const user: ShellUser = {
    name: ctx.name,
    role: ctx.role,
    companyName: ctx.company?.name || "Mi empresa",
    companyType: ctx.company?.company_type,
    modules: ctx.company?.modules_enabled || null,
    impersonating: ctx.impersonating,
    subscriptionStatus: ctx.company?.subscription_status,
    trialEndsAt: (ctx.company?.trial_ends_at as string) || null,
  };

  const badges = ctx.role === "superadmin" && !ctx.impersonating
    ? {}
    : await loadBadges(ctx as TenantContext & { companyId: string });
  const elapsed = Date.now() - started;
  if (process.env.NODE_ENV !== "production" && elapsed > 800) {
    console.warn(`[shell] DashboardLayout tardó ${elapsed}ms`);
  }

  return (
    <AppShell user={user} badges={badges}>
      {/* Lo que permite que el check-in siga en pie sin señal. Va aquí y no en
          la raíz: la página pública y el login sin red no pueden hacer nada
          útil de todas formas. */}
      <ServiceWorkerRegistrar />
      {children}
    </AppShell>
  );
}
