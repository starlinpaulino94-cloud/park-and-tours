import { requireTenant } from "@/lib/tenant";
import { decidableActionsFor, pendingFor } from "@/lib/approvals";
import { resolveUserNames } from "@/lib/user-directory";
import { companyTimeZone } from "@/lib/time";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { ApprovalRow } from "../../inicio/mi-dia/_components/approval-row";
import { refOf, toApprovalRowData } from "../../inicio/mi-dia/_components/sections";

export default async function Page() {
  const ctx = await requireTenant();
  const now = new Date();
  const tz = companyTimeZone(ctx.company);

  if (decidableActionsFor(ctx.role).length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Aprobaciones" />
        <EmptyState
          icon="UserCheck"
          title="No tienes aprobaciones asignadas"
          description="Las solicitudes sensibles aparecen aquí solo cuando tu rol puede decidirlas."
        />
      </div>
    );
  }

  const rows = await pendingFor(ctx, { limit: 50 });
  const names = await resolveUserNames(rows.map((row) => refOf(row.requested_by)));
  const approvals = rows.map((row) => toApprovalRowData(row, names, ctx, now, tz));

  return (
    <div className="space-y-5">
      <PageHeader title="Aprobaciones" />

      {approvals.length === 0 ? (
        <EmptyState
          icon="UserCheck"
          title="No hay solicitudes esperando tu decisión"
          description="Cuando exista una solicitud que puedas aprobar o rechazar aparecerá en esta lista."
        />
      ) : (
        <ul className="space-y-1.5">
          {approvals.map((approval) => <ApprovalRow key={approval.id} approval={approval} />)}
        </ul>
      )}
    </div>
  );
}
