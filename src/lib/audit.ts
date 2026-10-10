import { db } from "./db";

/**
 * Shared audit logging helper.
 * Logs mutation details into AuditLog table.
 */
export async function logAudit(
  entity: string,
  entityId: string,
  action: string,
  oldValue?: string | object | null,
  newValue?: string | object | null,
  userId: string = "system"
) {
  try {
    const oldStr =
      oldValue === undefined || oldValue === null
        ? null
        : typeof oldValue === "string"
        ? oldValue
        : JSON.stringify(oldValue);

    const newStr =
      newValue === undefined || newValue === null
        ? null
        : typeof newValue === "string"
        ? newValue
        : JSON.stringify(newValue);

    return await db.auditLog.create({
      data: {
        entity,
        entityId,
        action,
        oldValue: oldStr,
        newValue: newStr,
        userId,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
    // Don't fail the primary mutation if audit logging fails
    return null;
  }
}
