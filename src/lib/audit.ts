import { db } from "./db";

export async function logAudit(
  entity: string,
  entityId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  userId: string,
) {
  await db.auditLog.create({
    data: {
      entity,
      entityId,
      action,
      oldValue: oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue: newValue === undefined ? null : JSON.stringify(newValue),
      userId,
    },
  });
}
