/**
 * La operación diaria: flota, activos, atracciones, turnos, acreditaciones,
 * órdenes de trabajo, incidentes, casos de huésped y tickets de acceso.
 *
 * Es la mitad del sistema que no se ve en el mostrador pero sostiene todo lo
 * demás. Vacía, el parque parece una hoja de cálculo de reservas.
 */
export async function seed(h) {
  const hecho = {};
  const proveedores = await h.rows("supplier", "id,name", 10);
  const personal = await h.rows("staff", "id,full_name", 20);
  const zonas = await h.rows("zone", "id,name", 10);
  const clientes = await h.rows("customer", "id", 10);

  // ── flota ────────────────────────────────────────────────────────────────
  hecho.vehicle = await h.unless("vehicle", async () => {
    let n = 0;
    const flota = [
      { name: "Bus Punta Cana 01", plate: "A123456", vehicle_type: "bus", capacity: 45 },
      { name: "Minibús Bávaro", plate: "A654321", vehicle_type: "minibus", capacity: 19 },
      { name: "Buggy 4x4 · 1", plate: "B001", vehicle_type: "buggy", capacity: 2 },
      { name: "Catamarán Isla", plate: "N-0042", vehicle_type: "boat", capacity: 60 },
    ];
    for (const [i, v] of flota.entries()) {
      await h.insert("vehicle", {
        ...v,
        driver_id: personal[i % Math.max(personal.length, 1)]?.id ?? null,
        supplier_id: i === 3 ? proveedores[0]?.id ?? null : null,
        // Una caduca pronto a propósito: la pantalla de flota existe para avisar
        // de eso, y con todo en regla no enseña nada.
        insurance_expiry: h.dateOnly(i === 2 ? 12 : 200),
        inspection_expiry: h.dateOnly(i === 0 ? 25 : 180),
        status: i === 2 ? "in_service" : "available",
      });
      n++;
    }
    return n;
  });

  // ── atracciones del parque ───────────────────────────────────────────────
  hecho.attraction = await h.unless("attraction", async () => {
    let n = 0;
    const catalogo = [
      { name: "Tirolina del Cañón", code: "ATR-01", attraction_type: "adventure", capacity_hour: 60, min_height_cm: 120, requires_waiver: true, weather_sensitive: true, operational_status: "open", queue_minutes: 25 },
      { name: "Cenote Azul", code: "ATR-02", attraction_type: "water", capacity_hour: 120, min_age: 6, operational_status: "open", queue_minutes: 10 },
      { name: "Show de delfines", code: "ATR-03", attraction_type: "show", capacity_simultaneous: 300, duration_min: 45, operational_status: "open" },
      { name: "Montaña rusa Huracán", code: "ATR-04", attraction_type: "ride", capacity_hour: 800, min_height_cm: 140, max_weight_kg: 120, operational_status: "maintenance", queue_minutes: 0 },
    ];
    for (const [i, a] of catalogo.entries()) {
      await h.insert("attraction", {
        ...a,
        zone_id: zonas[i % Math.max(zonas.length, 1)]?.id ?? null,
        guests_today: a.operational_status === "open" ? 120 + i * 45 : 0,
        last_status_at: h.at(0, 7, 30),
        status: "active",
      });
      n++;
    }
    return n;
  });

  const atracciones = await h.rows("attraction", "id,name", 10);
  const vehiculos = await h.rows("vehicle", "id,name", 10);

  // ── activos ──────────────────────────────────────────────────────────────
  hecho.asset = await h.unless("asset", async () => {
    let n = 0;
    const bienes = [
      { name: "Generador principal", asset_type: "equipment", criticality: "critical", operational_status: "in_service", blocks_capacity: true },
      { name: "Compresor de buceo", asset_type: "equipment", criticality: "high", operational_status: "in_service" },
      { name: "Buggy 4x4 · unidad 7", asset_type: "buggy", criticality: "medium", operational_status: "out_of_service", blocks_capacity: true },
    ];
    for (const [i, b] of bienes.entries()) {
      await h.insert("asset", {
        ...b,
        code: `ACT-${String(i + 1).padStart(3, "0")}`,
        zone_id: zonas[i % Math.max(zonas.length, 1)]?.id ?? null,
        attraction_id: i === 0 ? atracciones[0]?.id ?? null : null,
        vehicle_id: i === 2 ? vehiculos[2]?.id ?? null : null,
        purchase_date: h.dateOnly(-700 - i * 100),
        purchase_cost: 12000 - i * 3000,
        currency: "usd",
        warranty_until: h.dateOnly(i === 1 ? 40 : 400),
        next_maintenance_at: h.at(i === 0 ? 5 : 45),
        downtime_minutes_month: i === 2 ? 480 : 0,
        status: "active",
      });
      n++;
    }
    return n;
  });

  // ── turnos y fichaje ─────────────────────────────────────────────────────
  hecho.shift = await h.unless("shift", async () => {
    if (personal.length === 0) return 0;
    let n = 0;
    for (const [i, persona] of personal.slice(0, 6).entries()) {
      const dia = i % 3;
      await h.insert("shift", {
        staff_id: persona.id,
        role_label: ["Guía", "Chófer", "Taquilla", "Socorrista"][i % 4],
        shift_date: h.dateOnly(dia),
        starts_at: h.at(dia, 7, 0),
        ends_at: h.at(dia, 15, 0),
        hours_planned: 8,
        break_min: 45,
        status: dia === 0 ? "published" : "planned",
        zone_id: zonas[i % Math.max(zonas.length, 1)]?.id ?? null,
      });
      n++;
    }
    return n;
  });

  hecho.attendance = await h.unless("attendance", async () => {
    const turnos = await h.rows("shift", "id,staff_id,shift_date", 10);
    let n = 0;
    for (const [i, t] of turnos.slice(0, 4).entries()) {
      await h.insert("attendance", {
        staff_id: t.staff_id,
        shift_id: t.id,
        attendance_date: t.shift_date,
        clock_in: h.at(-1, 7, i === 1 ? 22 : 0),
        clock_out: h.at(-1, 15, 10),
        hours_worked: 8,
        overtime_hours: i === 2 ? 1.5 : 0,
        // Uno llega tarde: si todos fichan puntuales, la pantalla no enseña para
        // qué sirve.
        status: i === 1 ? "late" : "present",
        method: "qr",
      });
      n++;
    }
    return n;
  });

  // ── acreditaciones, con una a punto de vencer ────────────────────────────
  hecho.certification = await h.unless("certification", async () => {
    if (personal.length === 0) return 0;
    let n = 0;
    const acreditaciones = [
      { name: "Socorrismo acuático", cert_type: "lifeguard", expires_at: h.dateOnly(18), blocks_assignment: true },
      { name: "Primeros auxilios", cert_type: "first_aid", expires_at: h.dateOnly(220) },
      { name: "Licencia de conducir D1", cert_type: "driving_license", expires_at: h.dateOnly(-5), blocks_assignment: true },
    ];
    for (const [i, c] of acreditaciones.entries()) {
      await h.insert("certification", {
        ...c,
        staff_id: personal[i % personal.length].id,
        issuer: "Cruz Roja Dominicana",
        number: `CERT-${9000 + i}`,
        issued_at: h.dateOnly(-500),
        // Una vencida: el sistema tiene que IMPEDIR asignarla, y eso solo se ve
        // si hay una vencida.
        status: i === 2 ? "expired" : i === 0 ? "expiring" : "valid",
        checked_at: h.at(0, 6, 0),
      });
      n++;
    }
    return n;
  });

  // ── órdenes de trabajo ───────────────────────────────────────────────────
  hecho.work_order = await h.unless("work_order", async () => {
    const activos = await h.rows("asset", "id,name", 5);
    let n = 0;
    const ordenes = [
      { title: "Revisión de frenos del buggy 7", order_type: "corrective", priority: "urgent", status: "in_progress", takes_asset_down: true },
      { title: "Mantenimiento preventivo del generador", order_type: "preventive", priority: "high", status: "assigned" },
      { title: "Cambio de filtros del compresor", order_type: "preventive", priority: "medium", status: "done" },
    ];
    for (const [i, o] of ordenes.entries()) {
      await h.insert("work_order", {
        ...o,
        code: `OT-${String(i + 1).padStart(4, "0")}`,
        asset_id: activos[i % Math.max(activos.length, 1)]?.id ?? null,
        opened_at: h.at(-(4 - i)),
        scheduled_at: h.at(i),
        finished_at: o.status === "done" ? h.at(-1, 14, 0) : null,
        description: "Detectado en la inspección de apertura.",
        work_performed: o.status === "done" ? "Filtros sustituidos y prueba de presión superada." : null,
        labor_hours: o.status === "done" ? 3 : null,
        labor_cost: o.status === "done" ? 90 : null,
        parts_cost: o.status === "done" ? 145 : null,
        total_cost: o.status === "done" ? 235 : null,
        currency: "usd",
        downtime_min: o.takes_asset_down ? 240 : 0,
      });
      n++;
    }
    return n;
  });

  // ── incidentes y casos de huésped ────────────────────────────────────────
  hecho.incident = await h.unless("incident", async () => {
    await h.insert("incident", {
      code: "INC-0001",
      occurred_at: h.at(-3, 11, 20),
      reported_at: h.at(-3, 11, 35),
      severity: "minor",
      incident_type: "injury",
      status: "investigating",
      title: "Raspadura en la zona de la tirolina",
      description: "Un visitante resbaló al bajar de la plataforma.",
      location: "Plataforma de salida",
      immediate_action: "Botiquín en el puesto, cliente atendido en el acto.",
      medical_attention: true,
      attraction_id: atracciones[0]?.id ?? null,
      zone_id: zonas[0]?.id ?? null,
      currency: "usd",
      estimated_cost: 0,
    });
    return 1;
  });

  hecho.guest_case = await h.unless("guest_case", async () => {
    let n = 0;
    const casos = [
      { case_type: "complaint", subject: "El bus llegó 40 minutos tarde al hotel", priority: "high", status: "in_progress", channel: "whatsapp" },
      { case_type: "compliment", subject: "Felicitación para el guía Ramón", priority: "low", status: "closed", channel: "email", satisfaction_score: 10 },
      { case_type: "lost_found", subject: "Gafas olvidadas en el catamarán", priority: "medium", status: "open", channel: "counter" },
    ];
    for (const [i, c] of casos.entries()) {
      await h.insert("guest_case", {
        ...c,
        code: `CASO-${String(i + 1).padStart(4, "0")}`,
        customer_id: clientes[i % Math.max(clientes.length, 1)]?.id ?? null,
        opened_at: h.at(-(6 - i)),
        description: "Registrado por el equipo de atención al huésped.",
        resolution: c.status === "closed" ? "Se trasladó la felicitación al guía y a su responsable." : null,
        resolved_at: c.status === "closed" ? h.at(-2) : null,
        compensation_type: c.case_type === "complaint" ? "voucher" : "none",
        compensation_amount: c.case_type === "complaint" ? 25 : 0,
        currency: "usd",
      });
      n++;
    }
    return n;
  });

  // ── tickets de acceso ────────────────────────────────────────────────────
  //
  // Hasta esta ola no había forma de emitirlos, así que la pantalla salía vacía
  // incluso con el parque lleno.
  hecho.access_ticket = await h.unless("access_ticket", async () => {
    const productos = await h.rows("product", "id", 5);
    let n = 0;
    for (let i = 0; i < 5; i++) {
      await h.insert("access_ticket", {
        code: `TK-2026-${String(1000 + i)}`,
        ticket_type: i < 3 ? "day_pass" : "multi_day",
        holder_name: ["Ana Rivas", "Luis Fernández", "Petra Müller", "John Carter", "Sofía Méndez"][i],
        customer_id: clientes[i % Math.max(clientes.length, 1)]?.id ?? null,
        product_id: productos[i % Math.max(productos.length, 1)]?.id ?? null,
        valid_from: h.at(-i, 8, 0),
        valid_to: h.at(i < 3 ? -i : 7 - i, 20, 0),
        entries_allowed: i < 3 ? 1 : 3,
        issued_at: h.at(-i, 7, 45),
        wristband_code: `PULS-${4000 + i}`,
        price: i < 3 ? 65 : 150,
        currency: "usd",
      });
      n++;
    }
    return n;
  });

  return hecho;
}
