/**
 * Repairs the Totalum schema so no field is treated as unique.
 *
 * Properties created through the REST schema API default to `canRepeat: null`,
 * which Totalum enforces as "this value can only exist once in the table".
 * That silently breaks every one-to-many relation (two zones in one company,
 * two bookings on one departure, two payments on one booking...) and every
 * repeated scalar (two products with status "active").
 *
 * Idempotent: run it as many times as needed.
 */
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const read = (k, fallback) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim() || fallback;

const API_KEY = read("TOTALUM_API_KEY");
const BASE = read("TOTALUM_API_URL", "https://api.totalum.app/");
if (!API_KEY) {
  console.error("[fix-repeat] falta TOTALUM_API_KEY en .env");
  process.exit(1);
}

const headers = { "api-key": API_KEY, "Content-Type": "application/json" };

async function main() {
  const res = await fetch(`${BASE}api/v1/data-structure`, { headers });
  if (!res.ok) throw new Error(`No se pudo leer el esquema: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  const structures = payload.data || payload;

  let checked = 0, fixed = 0, failed = 0;

  for (const structure of structures) {
    const props = Array.isArray(structure.properties)
      ? structure.properties
      : Object.values(structure.properties || {});

    for (const prop of props) {
      checked++;
      if (prop.canRepeat === true) continue;

      const url = `${BASE}api/v1/data-structure/${structure._id}/property/${prop.id}`;
      const body = JSON.stringify({ ...prop, canRepeat: true });
      const r = await fetch(url, { method: "PUT", headers, body });
      if (!r.ok) {
        failed++;
        console.error(`[fix-repeat] ERROR ${structure.type}.${prop.name}: ${r.status} ${(await r.text()).slice(0, 160)}`);
        continue;
      }
      fixed++;
      if (fixed % 50 === 0) console.log(`[fix-repeat] ${fixed} propiedades corregidas...`);
    }
  }

  console.log(`[fix-repeat] revisadas ${checked} · corregidas ${fixed} · fallidas ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[fix-repeat] fallo:", err);
  process.exit(1);
});
