import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";

export default function PortalPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon name="Handshake" className="size-6" />
      </span>
      <h1 className="font-display text-3xl font-semibold">Portal B2B</h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        El portal independiente para tour centers y agencias ya tiene su backend disponible
        (<span className="font-mono text-[12px]">/api/portal/summary</span> y{" "}
        <span className="font-mono text-[12px]">/api/portal/catalog</span>), que solo expone la información
        del propio partner. La interfaz está pendiente de construcción.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/"><Button variant="outline">Volver al inicio</Button></Link>
        <Link href="/dashboard"><Button>Ir al panel</Button></Link>
      </div>
    </div>
  );
}
