import "server-only";
import { createOrderWithBookings } from "@/lib/booking-service";
import { tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { FILES } from "../../assets/files";
import type { Currency } from "@/lib/types";

/**
 * Demo dataset — creates a realistic Caribbean operation so the ERP never
 * shows empty screens on the first login: catalogue, calendar, partners,
 * sellers, fleet, staff, customers, real bookings (priced by the engines),
 * payments and expenses.
 */

type Created = { _id: string };

const iso = (d: Date) => d.toISOString();
const at = (daysFromNow: number, hour = 7, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const PRODUCTS = [
  {
    name: "Isla Saona — Día completo",
    code: "SAONA",
    cover: FILES.excursionIsland,
    short: "Catamarán, lancha rápida, piscina natural y buffet caribeño en la isla más famosa del país.",
    description:
      "Navegación en lancha rápida hasta la piscina natural, tiempo libre en Playa Canto de la Playa y regreso en catamarán con animación, barra libre y buffet caribeño en la playa.",
    price: 89, cost: 41, duration: 9, capacity: 120, location: "Isla Saona, Parque Nacional del Este",
    meeting: "Muelle de Bayahíbe",
    inclusions: "Transporte, guía bilingüe, almuerzo buffet, barra libre nacional, impuestos de parque",
    exclusions: "Souvenirs, fotografías profesionales, propinas",
    times: ["07:00", "07:30"],
  },
  {
    name: "Snorkel en Arrecife Catalina",
    code: "CATALINA",
    cover: FILES.excursionSnorkel,
    short: "Dos paradas de snorkel sobre el muro de coral de Isla Catalina con equipo incluido.",
    description:
      "Salida en catamarán hacia Isla Catalina con dos paradas de snorkel guiado sobre el arrecife, almuerzo a bordo y tarde de playa.",
    price: 76, cost: 33, duration: 8, capacity: 60, location: "Isla Catalina, La Romana",
    meeting: "Marina Casa de Campo",
    inclusions: "Equipo de snorkel, guía acuático, almuerzo, bebidas",
    exclusions: "Traslado desde el hotel fuera de zona, fotos submarinas",
    times: ["08:00"],
  },
  {
    name: "Salto El Limón a caballo",
    code: "LIMON",
    cover: FILES.excursionWaterfall,
    short: "Cabalgata por la sierra de Samaná hasta una cascada de 52 metros.",
    description:
      "Cabalgata guiada por senderos de montaña hasta el Salto El Limón, baño en la poza natural y almuerzo típico dominicano de regreso.",
    price: 68, cost: 30, duration: 7, capacity: 40, location: "Samaná",
    meeting: "Rancho El Limón",
    inclusions: "Caballo y guía, almuerzo criollo, entrada al salto",
    exclusions: "Propina al guía de caballo, calzado adecuado",
    times: ["08:30"],
  },
  {
    name: "Catamarán al atardecer",
    code: "SUNSET",
    cover: FILES.excursionSunset,
    short: "Navegación premium al ocaso con barra libre, música en vivo y cena ligera.",
    description:
      "Salida vespertina en catamarán privado con barra libre premium, tapas caribeñas, música en vivo y parada para baño nocturno.",
    price: 95, cost: 38, duration: 3.5, capacity: 45, location: "Bávaro — Punta Cana",
    meeting: "Playa Cortecito",
    inclusions: "Barra libre premium, cena ligera, música en vivo",
    exclusions: "Traslados privados, fotografía",
    times: ["16:30"],
  },
  {
    name: "Buggies aventura extrema",
    code: "BUGGY",
    cover: FILES.excursionBuggy,
    short: "Ruta off-road por caminos rurales, cueva taína y playa Macao.",
    description:
      "Circuito en buggy biplaza por plantaciones de caña y café, visita a una casa típica, cenote taíno y baño en playa Macao.",
    price: 54, cost: 24, duration: 4, capacity: 48, location: "Macao — Punta Cana",
    meeting: "Base de operaciones Macao",
    inclusions: "Buggy biplaza, casco, guía, entrada a la cueva",
    exclusions: "Seguro de daños opcional, bebidas extra",
    times: ["09:00", "14:00"],
  },
  {
    name: "Santo Domingo Colonial",
    code: "COLONIAL",
    cover: FILES.excursionCity,
    short: "La primera ciudad de América con guía historiador y almuerzo en la Zona Colonial.",
    description:
      "City tour por la Ciudad Colonial declarada Patrimonio de la Humanidad: Alcázar de Colón, Calle Las Damas, Catedral Primada y tiempo de compras.",
    price: 82, cost: 36, duration: 10, capacity: 52, location: "Santo Domingo",
    meeting: "Recogida en hotel",
    inclusions: "Autobús con aire acondicionado, guía historiador, almuerzo, entradas",
    exclusions: "Compras personales, propinas",
    times: ["06:30"],
  },
  {
    name: "Avistamiento de ballenas jorobadas",
    code: "BALLENAS",
    cover: FILES.excursionWhales,
    short: "Temporada enero–marzo en la Bahía de Samaná con biólogo marino a bordo.",
    description:
      "Salida en embarcación autorizada por el Ministerio de Medio Ambiente con biólogo marino, hidrófono y visita a Cayo Levantado.",
    price: 110, cost: 52, duration: 8, capacity: 70, location: "Bahía de Samaná",
    meeting: "Puerto de Samaná",
    inclusions: "Embarcación autorizada, biólogo marino, almuerzo en Cayo Levantado",
    exclusions: "Bebidas alcohólicas, propinas",
    times: ["08:00"],
  },
  {
    name: "Traslado privado aeropuerto PUJ",
    code: "TRASLADO",
    cover: FILES.excursionCatamaran,
    short: "Traslado privado puerta a puerta con conductor bilingüe y bebida de bienvenida.",
    description:
      "Servicio privado desde el Aeropuerto Internacional de Punta Cana a cualquier hotel de Bávaro, Uvero Alto o Cap Cana.",
    price: 45, cost: 22, duration: 1, capacity: 8, location: "Punta Cana",
    meeting: "Terminal de llegadas PUJ",
    inclusions: "Vehículo privado, conductor bilingüe, agua",
    exclusions: "Silla de bebé bajo petición",
    times: ["10:00", "18:00"],
  },
];

const HOTELS = [
  { name: "Barceló Bávaro Palace", zone: "Bávaro", pickup: "Lobby principal", time: "07:15" },
  { name: "Meliá Punta Cana Beach", zone: "Bávaro", pickup: "Recepción", time: "07:20" },
  { name: "Hard Rock Hotel Punta Cana", zone: "Macao", pickup: "Lobby Star Class", time: "06:55" },
  { name: "Iberostar Selection Hacienda", zone: "Bávaro", pickup: "Entrada principal", time: "07:05" },
  { name: "Casa de Campo Resort", zone: "La Romana", pickup: "Marina Gate", time: "08:00" },
  { name: "Dreams Macao Beach", zone: "Macao", pickup: "Lobby", time: "07:00" },
  { name: "Bahia Principe Grand", zone: "Uvero Alto", pickup: "Plaza central", time: "06:40" },
];

const PARTNERS = [
  { name: "Caribe Tour Center SRL", commercial: "Caribe Tour Center", type: "tour_center", pct: 18, credit: 15000, days: 15, city: "Bávaro" },
  { name: "Sunlight Travel Agency", commercial: "Sunlight Travel", type: "agency", pct: 15, credit: 8000, days: 30, city: "Santo Domingo" },
  { name: "Atlantis Excursions Ltd", commercial: "Atlantis Excursions", type: "tour_operator", pct: 12, credit: 25000, days: 30, city: "Punta Cana" },
  { name: "Playa Dorada Desk", commercial: "Playa Dorada Desk", type: "tour_center", pct: 20, credit: 5000, days: 7, city: "Puerto Plata" },
  { name: "Nordic Holidays OTA", commercial: "Nordic Holidays", type: "ota", pct: 10, credit: 40000, days: 45, city: "Copenhague" },
];

const SELLERS = [
  { name: "Marisol Peña", email: "marisol@demo.tourflow.app", role: "supervisor", pct: 3, goal: 45000 },
  { name: "Junior Castillo", email: "junior@demo.tourflow.app", role: "seller", pct: 6, goal: 22000 },
  { name: "Ana Belén Reyes", email: "ana@demo.tourflow.app", role: "seller", pct: 6, goal: 20000 },
  { name: "Luis Alberto Cruz", email: "luis@demo.tourflow.app", role: "seller", pct: 5, goal: 18000 },
  { name: "Yamilé Santana", email: "yamile@demo.tourflow.app", role: "agent", pct: 7, goal: 15000 },
];

const CUSTOMERS = [
  { name: "Laura Gutiérrez", email: "laura.gutierrez@example.com", phone: "+34 655 12 33 44", country: "España", lang: "es" },
  { name: "Michael Brennan", email: "m.brennan@example.com", phone: "+1 305 555 0182", country: "Estados Unidos", lang: "en" },
  { name: "Sophie Laurent", email: "sophie.laurent@example.com", phone: "+33 6 12 45 78 90", country: "Francia", lang: "fr" },
  { name: "Familia Rodríguez", email: "rodriguez.family@example.com", phone: "+1 809 555 2211", country: "República Dominicana", lang: "es" },
  { name: "Klaus Bergmann", email: "k.bergmann@example.com", phone: "+49 171 2233445", country: "Alemania", lang: "de" },
  { name: "Giulia Ferrari", email: "giulia.ferrari@example.com", phone: "+39 340 998 1122", country: "Italia", lang: "it" },
  { name: "Emma Thompson", email: "emma.t@example.com", phone: "+44 7700 900123", country: "Reino Unido", lang: "en" },
  { name: "Carlos Mendoza", email: "cmendoza@example.com", phone: "+52 55 1234 5678", country: "México", lang: "es" },
];

const VEHICLES = [
  { name: "Coaster 01", type: "minibus", plate: "A123456", capacity: 28 },
  { name: "Coaster 02", type: "minibus", plate: "A654321", capacity: 28 },
  { name: "Autobús Marco Polo", type: "bus", plate: "B998877", capacity: 52 },
  { name: "Van Sprinter VIP", type: "van", plate: "V445566", capacity: 14 },
  { name: "Catamarán Anacaona", type: "boat", plate: "MAR-0091", capacity: 90 },
];

const STAFF = [
  { name: "Pedro Jiménez", type: "guide", langs: ["es", "en"], rate: 45 },
  { name: "Nathalie Duval", type: "guide", langs: ["fr", "en", "es"], rate: 52 },
  { name: "Ramón Ortiz", type: "driver", langs: ["es"], rate: 38 },
  { name: "Wilkins Peralta", type: "driver", langs: ["es", "en"], rate: 38 },
  { name: "Ingrid Möller", type: "coordinator", langs: ["de", "en", "es"], rate: 60 },
  { name: "Josué Ramírez", type: "photographer", langs: ["es", "en"], rate: 35 },
];

const SUPPLIERS = [
  { name: "Transporte Turístico del Este", type: "transport", terms: 15 },
  { name: "Restaurante Rancho Caribeño", type: "restaurant", terms: 7 },
  { name: "Marina Bayahíbe Boats", type: "boat", terms: 30 },
  { name: "Parque Nacional del Este", type: "park", terms: 0 },
];

export async function seedDemoData(ctx: TenantContext & { companyId: string }): Promise<{ created: Record<string, number> }> {
  const companyId = ctx.companyId;
  const currency = (ctx.company?.base_currency || "usd") as Currency;
  const counts: Record<string, number> = {};

  const create = async (table: string, data: Record<string, unknown>): Promise<Created> => {
    const res = await tenantCreate<Created>(companyId, table, data);
    counts[table] = (counts[table] || 0) + 1;
    return res;
  };

  const first = async <T = any>(table: string, filter: Record<string, unknown>): Promise<T | null> => {
    const rows = await tenantQuery<T>(companyId, table, { _filter: filter, _limit: 1 });
    return rows[0] || null;
  };

  const branch = await first<Created>("branch", {});
  const branchId = branch?._id;
  const categories = await tenantQuery<any>(companyId, "product_category", { _limit: 10 });
  const categoryByName = new Map<string, string>();
  for (const c of categories as any[]) categoryByName.set(c.name, c._id);
  const policy = await first<Created>("cancellation_policy", {});

  // -------------------------------------------------------------- zones/hotels
  const zoneIds = new Map<string, string>();
  for (const zoneName of ["Bávaro", "Macao", "Uvero Alto", "La Romana", "Santo Domingo", "Samaná"]) {
    const zone = await create("zone", {
      name: zoneName, description: `Zona turística de ${zoneName}`,
      color: "#0E7C86", status: "active",
    });
    zoneIds.set(zoneName, zone._id);
  }
  const hotelIds: string[] = [];
  for (const h of HOTELS) {
    const hotel = await create("hotel", {
      name: h.name, zone: zoneIds.get(h.zone),
      address: `${h.zone}, República Dominicana`,
      category: "5_star", pickup_point: h.pickup,
      pickup_offset_min: 20 + hotelIds.length * 5,
      phone: "+1 809 555 0100", status: "active",
      notes: `Recogida habitual a las ${h.time}.`,
    });
    hotelIds.push(hotel._id);
  }

  // ------------------------------------------------------------------ partners
  const partnerIds: string[] = [];
  for (const p of PARTNERS) {
    const partner = await create("partner", {
      name: p.name, commercial_name: p.commercial, partner_type: p.type,
      tax_id: `RNC-${Math.floor(100000000 + Math.random() * 800000000)}`,
      contact_name: "Departamento comercial",
      email: `reservas@${p.commercial.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      phone: "+1 809 555 0" + (100 + partnerIds.length),
      city: p.city, country: p.city === "Copenhague" ? "Dinamarca" : "República Dominicana",
      currency, default_commission_pct: p.pct,
      credit_limit: p.credit, credit_days: p.days, balance: 0,
      contract_from: iso(at(-180)), contract_to: iso(at(185)),
      commercial_terms: `Comisión ${p.pct}% · crédito ${p.days} días · facturación quincenal.`,
      status: "active", notes: "Partner de demostración.",
    });
    partnerIds.push(partner._id);
  }

  // ------------------------------------------------------------------- sellers
  const sellerIds: string[] = [];
  for (const s of SELLERS) {
    const [firstName, ...restName] = s.name.split(" ");
    const seller = await create("seller", {
      first_name: firstName, last_name: restName.join(" "),
      code: `V-${100 + sellerIds.length}`,
      email: s.email, phone: "+1 829 555 0" + (200 + sellerIds.length),
      branch: branchId, seller_role: s.role,
      supervisor: s.role !== "supervisor" && sellerIds[0] ? sellerIds[0] : undefined,
      partner: s.role === "agent" ? partnerIds[0] : undefined,
      commission_pct: s.pct, monthly_goal: s.goal,
      max_discount_pct: s.role === "supervisor" ? 15 : 5,
      currency, hire_date: iso(at(-420)), status: "active",
    });
    sellerIds.push(seller._id);
  }

  // ------------------------------------------------------------------ products
  const productIds: string[] = [];
  const modalityByProduct = new Map<string, { adult: string; child: string }>();
  for (const p of PRODUCTS) {
    const category =
      p.code === "TRASLADO" ? categoryByName.get("Transporte")
      : p.code === "BUGGY" ? categoryByName.get("Aventura")
      : p.code === "COLONIAL" ? categoryByName.get("Entradas y parques")
      : categoryByName.get("Excursiones");

    const product = await create("product", {
      category, cancellation_policy: policy?._id,
      name: p.name, code: p.code, product_type: p.code === "TRASLADO" ? "transfer" : "excursion",
      short_description: p.short, description: p.description,
      cover_image_url: p.cover,
      location: p.location, meeting_point: p.meeting,
      duration_hours: p.duration, languages: ["es", "en"],
      min_age: p.code === "BUGGY" ? 18 : 0, default_capacity: p.capacity,
      inclusions: p.inclusions, exclusions: p.exclusions,
      recommendations: "Traer protector solar biodegradable, toalla y documento de identidad.",
      base_price: p.price, base_cost: p.cost, currency,
      featured: ["SAONA", "SUNSET", "BALLENAS"].includes(p.code) ? "yes" : "no",
      sort_order: productIds.length + 1, status: "active",
    });
    productIds.push(product._id);

    const adult = await create("product_modality", {
      product: product._id, name: "Adulto", code: `${p.code}-AD`, modality_type: "adult",
      price: p.price, cost: p.cost, currency, age_from: 13, capacity_weight: 1,
      min_pax: 1, sort_order: 1, status: "active",
    });
    const child = await create("product_modality", {
      product: product._id, name: "Niño (4-12 años)", code: `${p.code}-CH`, modality_type: "child",
      price: Math.round(p.price * 0.55), cost: Math.round(p.cost * 0.6), currency,
      age_from: 4, age_to: 12, capacity_weight: 1, sort_order: 2, status: "active",
    });
    await create("product_modality", {
      product: product._id, name: "Infante (0-3 años)", code: `${p.code}-IN`, modality_type: "infant",
      price: 0, cost: 0, currency, age_from: 0, age_to: 3, capacity_weight: 0,
      sort_order: 3, status: "active",
    });
    modalityByProduct.set(product._id, { adult: adult._id, child: child._id });

    // B2B price list for the main tour center + an early-booking promotion window.
    await create("price_rule", {
      name: `Tarifa neta B2B — ${p.name}`, priority: 2,
      product: product._id, modality: adult._id, partner: partnerIds[0],
      channel: "b2b_portal", price_type: "b2b",
      amount: Math.round(p.price * 0.82), currency,
      season_from: iso(at(-90)), season_to: iso(at(275)),
      min_qty: 1, status: "active",
    });

    // Costs used by the profitability report.
    await create("product_cost", {
      product: product._id, concept: "Transporte terrestre", cost_type: "per_person",
      amount: Math.round(p.cost * 0.35), currency, status: "active",
    });
    await create("product_cost", {
      product: product._id, concept: "Guía y coordinación", cost_type: "per_departure",
      amount: 90, currency, status: "active",
    });
  }

  // ------------------------------------------------------------------ vehicles
  const vehicleIds: string[] = [];
  for (const v of VEHICLES) {
    const vehicle = await create("vehicle", {
      name: v.name, vehicle_type: v.type, plate: v.plate, capacity: v.capacity,
      insurance_expiry: iso(at(240)), inspection_expiry: iso(at(120)),
      status: "available", notes: "Unidad de flota propia.",
    });
    vehicleIds.push(vehicle._id);
  }

  // --------------------------------------------------------------------- staff
  const staffIds: string[] = [];
  for (const s of STAFF) {
    const staff = await create("staff", {
      full_name: s.name, staff_type: s.type,
      email: `${s.name.split(" ")[0].toLowerCase()}@demo.tourflow.app`,
      phone: "+1 809 555 0" + (300 + staffIds.length),
      languages: s.langs, daily_rate: s.rate, currency,
      license_expiry: s.type === "driver" ? iso(at(300)) : undefined,
      status: "active",
    });
    staffIds.push(staff._id);
  }

  // ----------------------------------------------------------------- suppliers
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const supplier = await create("supplier", {
      name: s.name, supplier_type: s.type,
      tax_id: `RNC-${Math.floor(100000000 + Math.random() * 800000000)}`,
      contact_name: "Administración", email: "admin@proveedor.do", phone: "+1 809 555 0400",
      currency, payment_terms_days: s.terms, balance: 0, status: "active",
    });
    supplierIds.push(supplier._id);
  }

  // ----------------------------------------------------------------- customers
  const customerIds: string[] = [];
  for (const c of CUSTOMERS) {
    const [cFirst, ...cRest] = c.name.split(" ");
    const customer = await create("customer", {
      first_name: cFirst, last_name: cRest.join(" "),
      email: c.email, phone: c.phone, whatsapp: c.phone,
      country: c.country, nationality: c.country, language: c.lang,
      hotel: hotelIds[customerIds.length % hotelIds.length],
      room: `${2 + (customerIds.length % 6)}0${1 + customerIds.length}`,
      assigned_seller: sellerIds[customerIds.length % sellerIds.length],
      source: "web", total_spent: 0, bookings_count: 0, status: "active",
    });
    customerIds.push(customer._id);
  }

  // --------------------------------------------------------------------- leads
  const leadStatuses = ["new", "contacted", "interested", "quoted", "follow_up", "booked", "lost"];
  for (let i = 0; i < 7; i++) {
    const lead = await create("lead", {
      name: ["Marta Solís", "David Chen", "Nathalie Bonnet", "Grupo Corporativo AZ", "Owen Fisher", "Paula Ibáñez", "Hiro Tanaka"][i],
      email: `lead${i + 1}@example.com`, phone: `+1 809 555 1${100 + i}`,
      whatsapp: `+1 809 555 1${100 + i}`,
      product: productIds[i % productIds.length],
      seller: sellerIds[i % sellerIds.length],
      partner: i % 3 === 0 ? partnerIds[i % partnerIds.length] : undefined,
      pax: 2 + (i % 6), estimated_value: 180 + i * 95, currency,
      travel_date: iso(at(6 + i * 2, 8)),
      source: ["web", "whatsapp", "referral", "walk_in", "instagram", "phone", "ota"][i],
      status: leadStatuses[i],
      next_action_at: iso(at(1 + i, 10)),
      lost_reason: leadStatuses[i] === "lost" ? "Precio por encima del presupuesto" : undefined,
      notes: "Solicita recogida en hotel y guía en su idioma.",
    });
    await create("crm_activity", {
      lead: lead._id,
      activity_type: (["note", "call", "whatsapp", "email"] as const)[i % 4],
      subject: "Primer contacto",
      notes: "Cliente interesado en excursión de día completo con recogida en hotel.",
      due_at: iso(at(1 + i, 10)),
      done_at: i % 2 === 0 ? iso(at(-2 - i, 11)) : undefined,
      status: i % 2 === 0 ? "done" : "pending",
    });
  }

  // ---------------------------------------------------------------- promotions
  await create("promotion", {
    name: "Reserva anticipada -10%", code: "EARLY10",
    discount_type: "percentage", value: 10,
    valid_from: iso(at(-30)), valid_to: iso(at(60)),
    min_amount: 100, max_uses: 500, used_count: 37,
    channels: ["web", "direct"], status: "active",
    description: "Descuento por reservar con más de 7 días de antelación.",
  });
  await create("promotion", {
    name: "Familia numerosa", code: "FAMILIA",
    discount_type: "fixed", value: 25,
    valid_from: iso(at(-10)), valid_to: iso(at(90)),
    min_amount: 250, max_uses: 200, used_count: 12,
    channels: ["direct", "walk_in", "pos"], status: "active",
    description: "25 de descuento en reservas de 4 pasajeros o más.",
  });

  // ---------------------------------------------------------------- departures
  const departureIds: { id: string; productId: string; date: Date }[] = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const productId = productIds[i];
    for (let day = -6; day <= 21; day++) {
      for (const time of p.times) {
        const [h, m] = time.split(":").map(Number);
        const when = at(day, h, m);
        const departure = await create("departure", {
          product: productId, branch: branchId,
          departure_at: iso(when), departure_time: time,
          capacity: p.capacity, booked_pax: 0, pending_pax: 0, available_pax: p.capacity,
          waitlist_pax: 0, cutoff_hours: 12,
          status: day < 0 ? "completed" : "available",
          meeting_point: p.meeting,
        });
        departureIds.push({ id: departure._id, productId, date: when });
      }
    }
  }

  // ------------------------------------------------------------ pickup routes
  const todayDepartures = departureIds.filter((d) => {
    const t = new Date();
    return d.date.toDateString() === t.toDateString();
  });
  for (let i = 0; i < Math.min(todayDepartures.length, 3); i++) {
    const d = todayDepartures[i];
    await create("pickup_route", {
      departure: d.id, name: `Ruta ${["Bávaro Norte", "Macao", "Uvero Alto"][i]}`,
      zone: zoneIds.get(["Bávaro", "Macao", "Uvero Alto"][i]),
      vehicle: vehicleIds[i % vehicleIds.length],
      driver: staffIds[2 + (i % 2)], guide: staffIds[i % 2],
      start_time: ["06:40", "07:00", "06:20"][i],
      pax_total: 0, stops_count: 3, status: "planned",
      notes: "Ruta planificada automáticamente por el módulo de operaciones.",
    });
    await create("departure_resource", {
      departure: d.id, vehicle: vehicleIds[i % vehicleIds.length],
      resource_role: "vehicle", pax_assigned: 0,
      cost: 180, currency, status: "confirmed",
      notes: "Transporte asignado a la ruta de recogida.",
    });
    await create("departure_resource", {
      departure: d.id, staff: staffIds[i % 2], resource_role: "guide",
      cost: 45, currency, status: "confirmed",
    });
  }

  // ------------------------------------------------------------------ bookings
  // Real bookings through the booking service so prices, commissions, vouchers,
  // participants and availability are all generated by the domain engines.
  const channels = ["direct", "web", "b2b_portal", "walk_in", "agency", "phone", "tour_center", "ota"] as const;
  let ordersCreated = 0;
  for (let i = 0; i < 26; i++) {
    const dep = departureIds[(i * 7) % departureIds.length];
    const adults = 1 + (i % 4);
    const children = i % 3 === 0 ? 1 + (i % 2) : 0;
    const channel = channels[i % channels.length];
    const usesPartner = ["b2b_portal", "agency", "tour_center", "ota"].includes(channel);
    const modality = modalityByProduct.get(dep.productId);

    try {
      const result = await createOrderWithBookings(ctx, {
        customer_id: customerIds[i % customerIds.length],
        branch_id: branchId,
        seller_id: usesPartner ? sellerIds[4] : sellerIds[1 + (i % 3)],
        partner_id: usesPartner ? partnerIds[i % partnerIds.length] : null,
        channel,
        currency,
        notes: "Reserva de demostración.",
        items: [
          {
            product_id: dep.productId,
            departure_id: dep.id,
            modality_id: modality?.adult,
            adults,
            children,
            pickup_hotel_id: hotelIds[i % hotelIds.length],
            pickup_time: HOTELS[i % HOTELS.length].time,
            pickup_location: HOTELS[i % HOTELS.length].pickup,
            room_number: `${3 + (i % 5)}0${1 + (i % 9)}`,
            participants: Array.from({ length: adults }, (_, k) => ({
              full_name: k === 0 ? CUSTOMERS[i % CUSTOMERS.length].name : `Acompañante ${k}`,
              category: "adult",
            })),
          },
        ],
      });
      ordersCreated++;
      counts.order = ordersCreated;
      counts.booking = (counts.booking || 0) + result.bookings.length;

      // Pay most of the bookings so the finance modules have real data.
      const booking = result.bookings[0];
      const isPast = dep.date.getTime() < Date.now();
      if (booking && (isPast || i % 4 !== 0)) {
        const amount = booking.total_amount ?? 0;
        const partial = i % 5 === 0 ? Math.round(amount * 0.5 * 100) / 100 : amount;
        await create("payment", {
          order: result.order._id, booking: booking._id,
          customer: customerIds[i % customerIds.length],
          partner: usesPartner ? partnerIds[i % partnerIds.length] : undefined,
          branch: branchId,
          reference: `PAY-DEMO-${1000 + i}`,
          payment_type: "payment",
          method: usesPartner ? "b2b_credit" : (["cash", "card", "transfer", "payment_link"] as const)[i % 4],
          status: "completed",
          amount: partial, currency, exchange_rate: 1,
          base_currency: currency, base_amount: partial,
          paid_at: iso(at(Math.min(0, Math.round((dep.date.getTime() - Date.now()) / 86_400_000)) - 1, 12)),
          notes: "Cobro de demostración.",
        });
        const patch = {
          paid_amount: partial,
          balance_amount: Math.round((amount - partial) * 100) / 100,
          status: partial >= amount ? "paid" : "partially_paid",
        };
        await tenantUpdate(companyId, "booking", booking._id, patch);
        await tenantUpdate(companyId, "order", result.order._id, {
          paid_total: partial,
          balance: Math.round(((result.order.total ?? amount) - partial) * 100) / 100,
          status: partial >= amount ? "paid" : "partially_paid",
        });
      }
    } catch (err) {
      // A single demo booking failing must not abort the whole seed, but it must be visible.
      console.error(`[demo-seed] no se pudo crear la reserva de demostración #${i}:`, err);
    }
  }

  // ------------------------------------------------------------------- expenses
  const expenseCategories = await tenantQuery<any>(companyId, "expense_category", { _limit: 20 });
  const expenseSamples = [
    { concept: "Combustible flota semana", amount: 640, cat: "Combustible" },
    { concept: "Mantenimiento Coaster 02", amount: 380, cat: "Mantenimiento" },
    { concept: "Campaña Meta Ads", amount: 520, cat: "Publicidad" },
    { concept: "Almuerzos operación Saona", amount: 910, cat: "Alimentación" },
    { concept: "Alquiler oficina Bávaro", amount: 1200, cat: "Alquiler" },
    { concept: "Uniformes y radios", amount: 275, cat: "Suministros" },
  ];
  for (let i = 0; i < expenseSamples.length; i++) {
    const e = expenseSamples[i];
    const cat = (expenseCategories as any[]).find((c) => c.name === e.cat);
    await create("expense", {
      category: cat?._id, branch: branchId,
      supplier: supplierIds[i % supplierIds.length],
      concept: e.concept, amount: e.amount, currency, exchange_rate: 1,
      expense_date: iso(at(-1 - i, 15)),
      payment_method: i % 2 === 0 ? "cash" : "transfer",
      status: "paid", notes: "Gasto de demostración.",
    });
  }

  // ------------------------------------------------------------------ payables
  for (let i = 0; i < 3; i++) {
    await create("payable", {
      supplier: supplierIds[i], concept: `Servicios ${SUPPLIERS[i].name}`,
      category: i === 0 ? "transport" : i === 1 ? "supplier" : "service",
      amount: 1450 + i * 620, paid_amount: i === 0 ? 700 : 0,
      balance: i === 0 ? 750 : 1450 + i * 620,
      currency, issue_date: iso(at(-20 - i * 8)), due_date: iso(at(-2 + i * 12)),
      status: i === 0 ? "partially_paid" : "pending",
      reference: `FACT-${2400 + i}`,
    });
  }

  console.log(`[demo-seed] datos de demostración creados para ${companyId}:`, counts);
  return { created: counts };
}
