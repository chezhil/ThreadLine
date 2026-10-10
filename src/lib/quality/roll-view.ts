import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Role } from "@/lib/auth";
import { reversalSummary } from "@/lib/reversals";

// What a roll read returns, per role. Every signed-in role can scan or list
// rolls, but only the roles that dispatch and bill (owner, storekeeper) need
// the order's price, the buyer's contact details and invoice links. QC
// records carry the inspector's (and any reverser's) name, never a user id.

const COMMERCIAL_ROLES: Role[] = ["owner", "storekeeper"];

export function canSeeCommercial(role: Role) {
  return COMMERCIAL_ROLES.includes(role);
}

export function rollInclude(role: Role, opts: { supplier?: boolean } = {}) {
  const commercial = canSeeCommercial(role);
  return {
    order: {
      select: {
        id: true,
        orderNo: true,
        status: true,
        fabricType: true,
        colour: true,
        gsm: true,
        qtyMetres: true,
        deadline: true,
        buyerId: true,
        ...(commercial
          ? {
              pricePerMetre: true,
              buyer: true,
              invoices: { select: { id: true, invoiceNo: true } },
            }
          : { buyer: { select: { id: true, name: true } } }),
      },
    },
    machine: true,
    yarnLot: { include: { yarnType: true, ...(opts.supplier ? { supplier: { select: { id: true, name: true } } } : {}) } },
    workOrder: { select: { id: true, stage: true, status: true, plannedQty: true, producedQty: true } },
    qcRecords: { orderBy: { inspectedAt: "desc" }, include: { reversal: reversalSummary } },
    dispatch: true,
  } satisfies Prisma.RollInclude;
}

type QcReversalRow = { reversedBy: string; reason: string; createdAt: Date; replacementId: string | null };
type QcRecordRow = { inspectorId: string; reversal?: QcReversalRow | null } & Record<string, unknown>;

/** Replaces each QC record's inspectorId (and its reversal's reversedBy) with
 * the person's name. */
export async function presentRolls<T extends { qcRecords: QcRecordRow[] }>(rolls: T[]) {
  const ids = [
    ...new Set(rolls.flatMap((r) => r.qcRecords.flatMap((q) => [q.inspectorId, ...(q.reversal ? [q.reversal.reversedBy] : [])]))),
  ];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rolls.map((roll) => ({
    ...roll,
    qcRecords: roll.qcRecords.map(({ inspectorId, reversal, ...rest }) => ({
      ...rest,
      inspectorName: names.get(inspectorId) ?? "Unknown inspector",
      reversal: reversal
        ? {
            reason: reversal.reason,
            createdAt: reversal.createdAt,
            replacementId: reversal.replacementId,
            reversedByName: names.get(reversal.reversedBy) ?? "Unknown user",
          }
        : null,
    })),
  }));
}
