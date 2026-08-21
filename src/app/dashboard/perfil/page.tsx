import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/tf/icon";
import { getTenantContext } from "@/lib/tenant";
import { initials } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadministrador",
  owner: "Propietario",
  admin: "Administrador",
  manager: "Gerente",
  operations: "Operaciones",
  cashier: "Caja",
  seller: "Vendedor",
  partner: "Partner",
};

export default async function DashboardProfilePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!ctx.companyId) redirect("/onboarding");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">Cuenta</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mi perfil</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Información de sesión, empresa y permisos con los que estás operando en el sistema.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="grid size-16 place-items-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
                {initials(ctx.name || ctx.email)}
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate text-xl">{ctx.name || "Usuario"}</CardTitle>
                <CardDescription className="truncate">{ctx.email}</CardDescription>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="secondary">{ROLE_LABEL[ctx.role] || ctx.role}</Badge>
                  {ctx.impersonating && <Badge variant="destructive">Impersonando empresa</Badge>}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoItem icon="Building2" label="Empresa" value={ctx.company?.name || "Sin empresa"} />
              <InfoItem icon="ShieldCheck" label="Rol activo" value={ROLE_LABEL[ctx.role] || ctx.role} />
              <InfoItem icon="Mail" label="Correo" value={ctx.email || "No disponible"} />
              <InfoItem icon="KeyRound" label="Estado de acceso" value={ctx.companyId ? "Asociado a empresa" : "Sin empresa"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon name="Lock" className="size-4 text-primary" /> Seguridad de cuenta
            </CardTitle>
            <CardDescription>
              Las acciones sensibles siguen administrándose desde los módulos correspondientes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="font-medium">Cambio de contraseña</p>
              <p className="mt-1 text-muted-foreground">
                El flujo de recuperación/cambio de contraseña todavía no está habilitado en producción.
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-4">
              <p className="font-medium">Cerrar sesión</p>
              <p className="mt-1 text-muted-foreground">
                Usa el menú de usuario en la esquina superior derecha para cerrar tu sesión sin salir de la estructura del dashboard.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border/70 p-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon name={icon} className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
