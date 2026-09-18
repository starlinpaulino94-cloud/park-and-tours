/**
 * Lo que comparten los módulos de siembra.
 *
 * Cada módulo recibe estas ayudas y BUSCA en la base lo que necesita —productos,
 * clientes, vendedores— en vez de recibir identificadores del orquestador. Así
 * cada uno se puede ejecutar solo, en cualquier orden dentro de su bloque, y
 * volver a ejecutarlo no duplica: si ya hay filas, no siembra.
 */
export function helpers(sb, orgId) {
  const now = new Date();

  /** Una fecha relativa a hoy, para que la demostración nunca se vea vieja. */
  const at = (days, hour = 9, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const dateOnly = (days) => at(days).slice(0, 10);

  async function insert(table, row) {
    const { data, error } = await sb
      .from(table)
      .insert({ organization_id: orgId, ...row })
      .select("id")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id;
  }

  /** Cuántas filas tiene ya esa tabla en la empresa demo. */
  async function count(table) {
    const { count: n, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return n ?? 0;
  }

  /** Las filas que ya existen, para colgar de ellas lo que venga después. */
  async function rows(table, columns = "id", limit = 50) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq("organization_id", orgId)
      .limit(limit);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  }

  /**
   * Siembra solo si la tabla está vacía.
   *
   * Es lo que hace que volver a ejecutar el sembrador sea inofensivo: sin esto,
   * cada pasada añadiría otra tanda y la demostración acabaría con seis veces
   * todo. Y el `--reset` sigue existiendo para empezar de cero a propósito.
   */
  async function unless(table, seed) {
    if ((await count(table)) > 0) return 0;
    return (await seed()) ?? 0;
  }

  return { sb, orgId, at, dateOnly, insert, count, rows, unless };
}
