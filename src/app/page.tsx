import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { FILES } from "../../assets/files";

const PILLARS = [
  {
    icon: "Database",
    title: "Una sola fuente de verdad",
    text: "Cliente → reserva → salida → pasajeros → canal → vendedor → comisión → pago → voucher → pickup → transporte → operación → liquidación → resultado. Toda la cadena trazable en un único registro.",
  },
  {
    icon: "Building2",
    title: "Multiempresa real",
    text: "Aislamiento por tenant aplicado en la base de datos, no solo en la interfaz. Grupos, sucursales, parques, tour centers, agencias y puntos de venta bajo una misma jerarquía.",
  },
  {
    icon: "Calculator",
    title: "Motores, no fórmulas sueltas",
    text: "CommissionEngine y PricingEngine con prioridad de reglas y snapshots inmutables: una comisión generada nunca cambia aunque edites la regla mañana.",
  },
];

const MODULES = [
  { icon: "LayoutDashboard", title: "Panel ejecutivo", text: "Ventas, reservas, pasajeros, márgenes, comisiones, cobros y caja del día en tiempo real.", href: "/dashboard" },
  { icon: "ShoppingCart", title: "Venta y POS", text: "Órdenes multi-producto, precio calculado por motor, vouchers y cobro en un solo flujo.", href: "/dashboard/pos" },
  { icon: "CalendarRange", title: "Salidas y cupos", text: "Excursión y salida son entidades distintas: cupo, lista de espera y bloqueo de sobreventa.", href: "/dashboard/salidas" },
  { icon: "CalendarCheck", title: "Reservas", text: "12 estados, historial completo, modificaciones auditadas y política de cancelación aplicada.", href: "/dashboard/reservas" },
  { icon: "Handshake", title: "Tour centers y agencias", text: "Contratos, condiciones comerciales, límite de crédito, tarifas B2B y catálogo autorizado.", href: "/dashboard/partners" },
  { icon: "Percent", title: "Comisiones", text: "Porcentaje, fija, escalonada o por volumen; vendedor, supervisor y agencia en la misma venta.", href: "/dashboard/comisiones" },
  { icon: "FileSpreadsheet", title: "Liquidaciones", text: "Agrupación por período y beneficiario con documento, estado y cuenta por pagar asociada.", href: "/dashboard/liquidaciones" },
  { icon: "Wallet", title: "Caja y arqueo", text: "Abrir caja, vender, registrar entradas y salidas, cerrar, arquear y explicar diferencias.", href: "/dashboard/caja" },
  { icon: "Radar", title: "Despacho diario", text: "07:00 Saona · 86 pasajeros · 4 vehículos · 3 guías · 12 hoteles, con detección de conflictos.", href: "/dashboard/operaciones" },
  { icon: "ScanLine", title: "Check-in y vouchers", text: "Escaneo, check-in parcial, no-show y vouchers de un solo uso imposibles de reutilizar.", href: "/dashboard/checkin" },
  { icon: "Bus", title: "Transporte y pickups", text: "Flota, conductores, rutas por zona y hotel, manifiestos y control de capacidad.", href: "/dashboard/transporte" },
  { icon: "TrendingUp", title: "Rentabilidad", text: "Ingreso − descuentos − comisiones − transporte − guía − proveedor = margen de contribución.", href: "/dashboard/rentabilidad" },
];

const CHAIN = [
  "Cliente", "Reserva", "Salida", "Pasajeros", "Canal", "Vendedor",
  "Comisión", "Pago", "Voucher", "Pickup", "Operación", "Liquidación", "Margen",
];

const AUDIENCES = [
  { title: "Parques y atracciones", text: "Cupos por sesión, entradas por modalidad, taquillas y arqueo por terminal." },
  { title: "Empresas de excursiones", text: "Salidas diarias, recogidas en hotel, guías, transporte y proveedores." },
  { title: "Tour operadores", text: "Red de tour centers, tarifas netas, portal B2B y liquidaciones quincenales." },
  { title: "Agencias y puntos de venta", text: "Catálogo autorizado, disponibilidad real y comisión visible al instante." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ------------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-primary font-display text-base font-bold text-primary-foreground">T</span>
            <span className="font-display text-lg font-semibold tracking-tight">TourFlow</span>
          </Link>
          <nav className="ml-8 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#modulos" className="transition-colors hover:text-foreground">Módulos</a>
            <a href="#cadena" className="transition-colors hover:text-foreground">Trazabilidad</a>
            <a href="#sectores" className="transition-colors hover:text-foreground">Sectores</a>
            <Link href="/portal" className="transition-colors hover:text-foreground">Portal B2B</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login"><Button variant="ghost" size="sm">Entrar</Button></Link>
            <Link href="/register"><Button size="sm" className="rounded-full px-4">Crear cuenta</Button></Link>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section className="tf-mesh tf-grain relative overflow-hidden">
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-28">
          <div className="tf-rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
              <span className="size-1.5 rounded-full bg-[oklch(0.79_0.14_80)]" /> ERP · OMS · Booking System
            </p>
            <h1 className="font-display text-[42px] font-semibold leading-[1.05] text-white sm:text-[56px] lg:text-[64px]">
              El sistema operativo de la industria de excursiones y parques
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/75">
              No es solo un motor de reservas. TourFlow centraliza la operación administrativa, comercial,
              financiera y logística de parques turísticos, operadores, tour centers y agencias —
              desde una excursión al día hasta miles de reservas diarias en varias empresas.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg" className="gap-2 rounded-full bg-white px-7 text-[oklch(0.24_0.035_210)] hover:bg-white/90">
                  Empezar prueba gratuita <Icon name="ArrowRight" className="size-4" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button size="lg" variant="outline" className="rounded-full border-white/30 bg-white/5 px-7 text-white hover:bg-white/15 hover:text-white">
                  Ver el panel
                </Button>
              </Link>
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/15 pt-7">
              {[
                { k: "35", v: "módulos operativos" },
                { k: "100%", v: "trazabilidad por reserva" },
                { k: "0", v: "sobreventas silenciosas" },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="font-display text-3xl font-semibold text-white">{s.k}</dt>
                  <dd className="mt-1 text-[12px] uppercase tracking-wider text-white/55">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative tf-rise" style={{ animationDelay: "160ms" }}>
            <div className="tf-drift overflow-hidden rounded-[22px] border border-white/15 shadow-2xl">
              <img src={FILES.heroBeach} alt="Excursión en catamarán por el Caribe" className="h-[300px] w-full object-cover sm:h-[420px]" />
            </div>
            <div className="absolute -bottom-8 -left-4 w-[240px] rounded-2xl border border-white/15 bg-[oklch(0.19_0.028_214)]/95 p-4 shadow-2xl backdrop-blur sm:-left-10 sm:w-[280px]">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Despacho de hoy</p>
              <p className="mt-2 font-display text-xl font-semibold text-white">07:00 · Isla Saona</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["86", "pax"], ["4", "vehículos"], ["12", "hoteles"]].map(([k, v]) => (
                  <div key={v} className="rounded-lg bg-white/10 py-2">
                    <p className="font-display text-base font-semibold text-white">{k}</p>
                    <p className="text-[10px] uppercase tracking-wide text-white/55">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ pillars */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <article key={p.title} className="tf-card tf-rise p-6" style={{ animationDelay: `${i * 90}ms` }}>
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon name={p.icon} className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-xl font-semibold">{p.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- chain */}
      <section id="cadena" className="border-y border-border bg-secondary/50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Trazabilidad completa</p>
          <h2 className="mt-3 max-w-3xl font-display text-3xl font-semibold sm:text-4xl">
            Cada venta se puede seguir de punta a punta, sin hojas de cálculo paralelas
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-2">
            {CHAIN.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-medium shadow-sm">
                  {step}
                </span>
                {i < CHAIN.length - 1 && <Icon name="ChevronRight" className="size-3.5 text-muted-foreground/60" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ modules */}
      <section id="modulos" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Todo el negocio</p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">Módulos del sistema</h2>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            Entra directamente a cualquier área. Los permisos por rol deciden lo que cada persona puede ver.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => (
            <Link
              key={m.href}
              href={m.href}
              className="tf-card tf-rise group flex flex-col gap-2 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40"
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon name={m.icon} className="size-[18px]" />
              </span>
              <h3 className="mt-1 font-display text-[17px] font-semibold">{m.title}</h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{m.text}</p>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[12px] font-semibold text-primary">
                Abrir módulo <Icon name="ArrowRight" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- audiences */}
      <section id="sectores" className="border-t border-border bg-secondary/40 py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:px-8">
          <div className="overflow-hidden rounded-[22px] border border-border shadow-xl">
            <img src={FILES.showcaseSnorkel} alt="Grupo de turistas haciendo snorkel" className="h-[340px] w-full object-cover" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Un producto, muchos modelos de negocio</p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
              La misma plataforma se adapta al tipo de empresa
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Al crear la empresa eliges su tipo y TourFlow destaca los módulos que necesitas — sin aplicaciones separadas ni versiones distintas.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {AUDIENCES.map((a) => (
                <div key={a.title} className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-display text-base font-semibold">{a.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{a.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- b2b + cta */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="tf-mesh tf-grain relative overflow-hidden rounded-[26px] px-6 py-14 text-center sm:px-14">
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-white sm:text-[40px]">
              Empieza a operar hoy con datos reales
            </h2>
            <p className="mt-4 text-white/70">
              Crea tu empresa y el sistema se configura solo: catálogo, calendario de salidas, red de vendedores,
              tour centers, flota, caja y reservas de ejemplo listas para explorar.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/register">
                <Button size="lg" className="gap-2 rounded-full bg-white px-8 text-[oklch(0.24_0.035_210)] hover:bg-white/90">
                  Crear mi empresa <Icon name="ArrowRight" className="size-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="rounded-full border-white/30 bg-white/5 px-8 text-white hover:bg-white/15 hover:text-white">
                  Ya tengo cuenta
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- footer */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">T</span>
              <span className="font-display text-base font-semibold">TourFlow</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Sistema integral de gestión turística para parques, excursiones, tour centers y agencias.
            </p>
          </div>
          <FooterCol title="Operación" links={[
            ["Panel ejecutivo", "/dashboard"],
            ["Reservas", "/dashboard/reservas"],
            ["Despacho diario", "/dashboard/operaciones"],
            ["Check-in", "/dashboard/checkin"],
          ]} />
          <FooterCol title="Comercial" links={[
            ["Nueva venta", "/dashboard/pos"],
            ["Excursiones", "/dashboard/productos"],
            ["Tour centers", "/dashboard/partners"],
            ["Portal B2B", "/portal"],
          ]} />
          <FooterCol title="Plataforma" links={[
            ["Panel SaaS", "/superadmin"],
            ["Configuración", "/dashboard/configuracion"],
            ["Términos", "/terms-of-service"],
            ["Privacidad", "/privacy-policy"],
          ]} />
        </div>
        <div className="border-t border-border px-4 py-5 text-center text-[12px] text-muted-foreground">
          © {new Date().getFullYear()} TourFlow. Construido para operar, no solo para reservar.
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-[13px] text-foreground/80 transition-colors hover:text-primary">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
