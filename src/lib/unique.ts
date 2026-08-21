import "server-only";
import { tenantQuery } from "@/lib/tenant";

/**
 * Application-level uniqueness for document codes (AUD-D01).
 *
 * Totalum cannot declare unique constraints (every property must be
 * `canRepeat: true` or one-to-many relations break), so uniqueness has to be
 * enforced in code. Codes are generated with a CSPRNG over a wide space
 * (`codes.ts`), making collisions already unlikely; this helper re-checks the
 * generated value against the tenant and regenerates on the rare hit, so
 * duplicate order/booking/voucher numbers become effectively impossible at
 * scale. It is best-effort: if the lookups fail it returns a freshly generated
 * code rather than blocking a sale.
 */
export async function uniqueCode(
  companyId: string,
  table: string,
  field: string,
  generate: () => string,
  attempts = 5
): Promise<string> {
  let code = generate();
  for (let i = 0; i < attempts; i++) {
    try {
      const clash = await tenantQuery<{ _id: string }>(companyId, table, {
        _filter: { [field]: code },
        _limit: 1,
      });
      if (clash.length === 0) return code;
    } catch (err) {
      console.error(`[unique] no se pudo verificar ${table}.${field}, se acepta el código generado:`, err);
      return code;
    }
    code = generate();
  }
  return code;
}
