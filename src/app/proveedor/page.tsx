import { redirect } from "next/navigation";
import { getTenantContext, tenantQuery, esDeProveedor } from "@/lib/tenant";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPLIER_TYPE } from "@/lib/labels";

/**
 * LA FICHA DEL PROVEEDOR, VISTA POR ÉL.
 *
 * Lo primero que tiene que poder hacer un actor nuevo es comprobar que el
 * sistema sabe quién es. Sus servicios llegan en la entrega siguiente; esto es
 * el suelo sobre el que se apoyan, y existe desde ya porque una pantalla que
 * redirige a una ruta que no existe es un 404 con otro nombre.
 *
 * Lo que enseña son SUS datos de contacto y su acuerdo, nada más. El saldo, el
 * histórico de pagos y las liquidaciones tienen su propia pantalla y su propio
 * ámbito: mezclarlos aquí sería abrir la puerta antes de poner la cerradura.
 */
export default async function ProveedorPage() {
  const ctx = await getTenantContext();
  if (!ctx?.companyId) redirect("/login");

  if (!esDeProveedor(ctx)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Portal de proveedores" description="Lo que ve un proveedor de esta operadora." />
        <EmptyState
          icon="Truck"
          title="Estás viendo el portal desde dentro"
          description="Tu usuario no está vinculado a ninguna ficha de proveedor, así que aquí no hay servicios que enseñarte. Vincula la cuenta desde la ficha del proveedor para que él entre con la suya."
        />
      </div>
    );
  }

  const [ficha] = await tenantQuery<{
    name?: string; supplier_type?: string; contact_name?: string;
    email?: string; phone?: string; payment_terms_days?: number | null; currency?: string;
  }>(ctx.companyId, "supplier", { _filter: { _id: ctx.supplierId }, _limit: 1 });

  const dato = (etiqueta: string, valor: string | number | null | undefined) => (
    <div className="flex justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium">
        {valor === null || valor === undefined || valor === "" ? "—" : valor}
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={ficha?.name || "Mi ficha"}
        description="Lo que la operadora tiene registrado de ti."
      />
      <Card>
        <CardHeader><CardTitle>Datos de contacto y acuerdo</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {dato("Tipo de proveedor", SUPPLIER_TYPE[ficha?.supplier_type || ""]?.label || ficha?.supplier_type)}
          {dato("Persona de contacto", ficha?.contact_name)}
          {dato("Correo", ficha?.email)}
          {dato("Teléfono", ficha?.phone)}
          {/**
            * «Sin plazo pactado» y no «0 días»: un cero dice que se paga el
            * mismo día, que es una afirmación, y lo que pasa aquí es que nadie
            * lo fijó. El mismo criterio que la comisión sin declarar.
            */}
          {dato(
            "Plazo de pago",
            ficha?.payment_terms_days == null ? null : `${ficha.payment_terms_days} días`
          )}
          {dato("Moneda", (ficha?.currency || "").toUpperCase())}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Si algo de esto no cuadra, díselo a tu operadora: esta pantalla lo muestra, no lo edita.
      </p>
    </div>
  );
}
