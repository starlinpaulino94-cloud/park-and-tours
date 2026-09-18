/**
 * Lo que sostiene el sistema por debajo: integraciones, plantillas de mensaje,
 * documentos con acuse, el bitácora del parque, planes de mantenimiento, y el
 * diario de salud de la ola 8.
 *
 * Es lo que hace que una demostración parezca un sistema vivo y no una base de
 * datos recién creada: trabajos que corrieron anoche, un incidente técnico ya
 * resuelto, mensajes en cola.
 */
export async function seed(h) {
  const hecho = {};

  // ── integraciones ────────────────────────────────────────────────────────
  hecho.integration = await h.unless("integration", async () => {
    let n = 0;
    for (const i of [
      { name: "Viator", provider: "viator", category: "ota", direction: "inbound", status: "active", sync_frequency: "realtime", records_synced: 184 },
      { name: "GetYourGuide", provider: "getyourguide", category: "ota", direction: "inbound", status: "active", sync_frequency: "realtime", records_synced: 97 },
      { name: "MembeGo", provider: "membego", category: "platform", direction: "bidirectional", status: "active", sync_frequency: "hourly", records_synced: 42 },
    ]) {
      await h.insert("integration", {
        ...i,
        endpoint_url: "/api/octo/v1",
        last_sync_at: h.at(0, 6, 15),
        webhook_secret_set: true,
        config: { mode: "demostración" },
      });
      n++;
    }
    return n;
  });

  // ── plantillas de mensaje ────────────────────────────────────────────────
  hecho.message_template = await h.unless("message_template", async () => {
    let n = 0;
    const plantillas = [
      { key: "booking_confirmation", channel: "email", subject: "Tu reserva está confirmada", body: "Hola {{cliente}}, tu {{producto}} del {{fecha}} está confirmada." },
      { key: "pre_tour_reminder", channel: "whatsapp", subject: null, body: "¡Mañana es el día! Recogida a las {{hora}} en {{punto}}.", offset_hours: -24 },
      { key: "balance_due", channel: "email", subject: "Saldo pendiente de tu reserva", body: "Queda {{saldo}} por pagar antes del {{vencimiento}}." },
      { key: "post_tour_thanks", channel: "email", subject: "¿Qué tal fue?", body: "Gracias por venir. Cuéntanos tu experiencia.", offset_hours: 24 },
    ];
    for (const p of plantillas) {
      await h.insert("message_template", { ...p, language: "es", status: "active" });
      n++;
    }
    return n;
  });

  // ── documentos con acuse de lectura ──────────────────────────────────────
  hecho.document = await h.unless("document", async () => {
    let n = 0;
    for (const d of [
      { title: "Protocolo de evacuación", doc_type: "protocol", requires_ack: true, audience: "all" },
      { title: "Manual del guía", doc_type: "manual", requires_ack: true, audience: "operations" },
      { title: "Política de cancelaciones", doc_type: "policy", requires_ack: false, audience: "all" },
    ]) {
      await h.insert("document", {
        ...d,
        version: "2026.1",
        body: "Contenido de demostración.",
        effective_from: h.dateOnly(-60),
        status: "active",
      });
      n++;
    }
    return n;
  });

  // ── bitácora del parque ──────────────────────────────────────────────────
  //
  // Una atracción que abre, cierra por lluvia y vuelve a abrir: es lo que
  // convierte la pantalla de control en algo que se mira, no en una lista.
  hecho.attraction_log = await h.unless("attraction_log", async () => {
    const atracciones = await h.rows("attraction", "id,name", 5);
    if (atracciones.length === 0) return 0;
    let n = 0;
    const eventos = [
      { event_type: "open", from_status: "closed", to_status: "open", hora: 8, guests: 0 },
      { event_type: "close", from_status: "open", to_status: "weather_hold", hora: 13, reason: "Tormenta eléctrica", duration_min: 45 },
      { event_type: "open", from_status: "weather_hold", to_status: "open", hora: 14, guests: 180 },
      { event_type: "close", from_status: "open", to_status: "closed", hora: 18, guests: 420 },
    ];
    for (const e of eventos) {
      await h.insert("attraction_log", {
        attraction_id: atracciones[0].id,
        ...e,
        logged_at: h.at(-1, e.hora, 0),
      });
      n++;
    }
    return n;
  });

  // ── acciones correctivas de un incidente ────────────────────────────────
  hecho.incident_action = await h.unless("incident_action", async () => {
    const incidentes = await h.rows("incident", "id", 5);
    if (incidentes.length === 0) return 0;
    let n = 0;
    for (const [i, a] of [
      { action: "Colocar cinta antideslizante en la plataforma", status: "done", priority: "high" },
      { action: "Revisar el protocolo de bajada con todo el equipo", status: "in_progress", priority: "medium" },
    ].entries()) {
      await h.insert("incident_action", {
        incident_id: incidentes[0].id,
        ...a,
        description: "Derivada de la investigación del incidente.",
        due_date: h.dateOnly(3 + i * 4),
        completed_at: a.status === "done" ? h.at(-1) : null,
      });
      n++;
    }
    return n;
  });

  // ── mantenimiento preventivo programado ─────────────────────────────────
  hecho.maintenance_plan = await h.unless("maintenance_plan", async () => {
    const activos = await h.rows("asset", "id,name", 5);
    const vehiculos = await h.rows("vehicle", "id,name", 5);
    let n = 0;
    for (const [i, p] of [
      { name: "Revisión mensual del generador", trigger_type: "calendar", interval_days: 30, estimated_min: 120, estimated_cost: 180, takes_asset_down: true },
      { name: "Cambio de aceite de la flota", trigger_type: "meter", interval_km: 10000, estimated_min: 90, estimated_cost: 95 },
    ].entries()) {
      await h.insert("maintenance_plan", {
        ...p,
        asset_id: i === 0 ? activos[0]?.id ?? null : null,
        vehicle_id: i === 1 ? vehiculos[0]?.id ?? null : null,
        lead_time_days: 5,
        task_list: "Inspección visual · prueba de carga · registro de horas",
        last_executed_at: h.at(-(25 + i * 5)),
        next_due_at: h.at(i === 0 ? 5 : 20),
        status: "active",
      });
      n++;
    }
    return n;
  });

  // ── el diario de la ola 8: trabajos que corrieron anoche ────────────────
  //
  // Sin esto, la pantalla de estado diría «nunca se ha ejecutado» de los cinco
  // trabajos y la demostración empezaría con todo en rojo.
  hecho.job_run = await h.unless("job_run", async () => {
    let n = 0;
    const trabajos = [
      { job: "expire-approvals", hora: 4, summary: { expired: 2 } },
      { job: "dispatch-messages", hora: 6, summary: { companies: 1, sent: 14, failed: 0, waiting: 3 } },
      { job: "collections", hora: 7, summary: { reminders: 5, overdue: 2, released: 1 } },
      { job: "certifications", hora: 5, summary: { reviewed: 3, updated: 1, notified: 1 } },
      { job: "allotments", hora: 3, summary: { reviewed: 4, released: 2, seats: 18 } },
    ];
    for (const t of trabajos) {
      // Dos noches, para que se vea una racha y no un punto suelto.
      for (const dia of [-1, 0]) {
        await h.insert("job_run", {
          job: t.job,
          trigger: "cron",
          started_at: h.at(dia, t.hora, 0),
          finished_at: h.at(dia, t.hora, 1),
          status: "ok",
          summary: t.summary,
        });
        n++;
      }
    }
    return n;
  });

  // ── un incidente técnico ya resuelto ────────────────────────────────────
  hecho.system_incident = await h.unless("system_incident", async () => {
    await h.insert("system_incident", {
      fingerprint: "/api/orders|tiempo de espera agotado contra el proveedor",
      source: "/api/orders",
      message: "tiempo de espera agotado contra el proveedor",
      level: "warning",
      occurrences: 3,
      first_seen_at: h.at(-6, 11, 0),
      last_seen_at: h.at(-6, 11, 20),
      status: "resolved",
      context: { method: "POST", status: 504 },
    });
    return 1;
  });

  return hecho;
}
