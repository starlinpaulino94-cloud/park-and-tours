import { requireTenant, atLeast } from "@/lib/tenant";
import { COMPANY_EXPORT_AREAS, companyExportPlan, companyExportFilename } from "@/lib/company-export";
import { ROWS_PER_TABLE } from "@/lib/company-export-service";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/tf/icon";
import { DescargarTodo } from "./_components/descargar";

/**
 * LLÉVATE TUS DATOS.
 *
 * Esta pantalla contesta la objeción que de verdad frena una venta: «y si mañana
 * me quiero ir, ¿mis datos se quedan aquí?». No la contesta con una promesa en
 * la letra pequeña —la contesta con un botón que devuelve las ochenta y ocho
 * tablas en un archivo que se abre con doble clic.
 *
 * Por eso ENSEÑA EL INVENTARIO antes de descargar nada. Un botón solo, sin decir
 * qué se lleva, exige confianza; la lista de lo que contiene la demuestra. Y es
 * la misma lista que usa el servidor, así que no puede prometer una tabla que
 * luego no salga.
 */
export default async function Page() {
  const ctx = await requireTenant();

  // Rol: el mismo umbral que la API. Aquí se explica en vez de dar un 403, que
  // en una pantalla se lee como «algo se rompió».
  if (!atLeast(ctx.role, "admin")) {
    return (
      <div className="space-y-5">
        <PageHeader title="Llévate tus datos" />
        <EmptyState
          icon="ShieldCheck"
          title="Solo un administrador puede exportar la empresa completa"
          description="El archivo contiene la cartera de clientes, los precios, las comisiones de cada partner y la contabilidad. Pídeselo a quien administra la cuenta; tú sí puedes exportar cada listado al que tienes acceso, con el botón Exportar de su pantalla."
        />
      </div>
    );
  }

  const plan = companyExportPlan();
  const nombre = ctx.company?.name || ctx.company?.legal_name || "empresa";
  const porArea = COMPANY_EXPORT_AREAS.map((area) => ({
    label: area.label,
    files: plan.filter((p) => p.area === area.label),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administración"
        title="Llévate tus datos"
        description={`Una copia completa de ${nombre}: ${plan.length} tablas, un archivo CSV por cada una, dentro de un solo ZIP. Son tus datos y puedes sacarlos cuando quieras, también si tu suscripción está vencida.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Descargar ahora</CardTitle>
          <CardDescription>
            El archivo se llamará <span className="font-mono text-xs">{companyExportFilename(nombre)}</span> y
            queda registrado en la bitácora de auditoría, como cualquier movimiento sensible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DescargarTodo filename={companyExportFilename(nombre)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Qué formato tiene</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm text-muted-foreground">
            <p className="flex gap-2">
              <Icon name="FileSpreadsheet" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Un CSV por tabla, en UTF-8 con la marca que Excel necesita para los acentos. Fechas en
                DD/MM/AAAA y números con punto decimal: se abre y se suma sin tocar nada.
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="Table" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Las columnas que apuntan a otra tabla llevan su identificador, no el nombre. Están todas las
                tablas en el mismo archivo, así que cualquier referencia se puede cruzar.
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="FileText" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Dentro van un <span className="font-mono text-xs">LEEME.txt</span> que explica todo esto y un{" "}
                <span className="font-mono text-xs">_inventario.csv</span> con las {plan.length} tablas y cuántos
                registros trae cada una —incluidas las que estaban vacías.
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lo que conviene saber</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm text-muted-foreground">
            <p className="flex gap-2">
              <Icon name="Gauge" className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                Cada tabla sale con hasta {ROWS_PER_TABLE.toLocaleString("es-DO")} registros. Si alguna tiene
                más, el LEEME lo dice y esa lista se exporta por rango de fechas desde su pantalla.
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="Eye" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                ¿Quieres un archivo LEGIBLE de una sola lista, con los nombres ya resueltos? Usa el botón
                Exportar de esa pantalla. Ese formato además se puede volver a importar.
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="Lock" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                El archivo no se guarda en ningún servidor: se arma para ti y viaja directo a tu equipo. Tres
                descargas por hora, porque cada una recorre la base entera.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qué contiene, carpeta por carpeta</CardTitle>
          <CardDescription>
            Las mismas áreas del menú. Una tabla vacía no genera archivo, pero aparece en el inventario.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {porArea.map((area) => (
            <div key={area.label} className="min-w-0">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                <Icon name="FolderOpen" className="size-3.5 text-muted-foreground" />
                {area.label}
                <span className="font-normal text-muted-foreground">({area.files.length})</span>
              </p>
              <ul className="space-y-0.5">
                {area.files.map((file) => (
                  <li key={file.path} className="truncate font-mono text-[11px] text-muted-foreground">
                    {file.path.split("/")[1]}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
