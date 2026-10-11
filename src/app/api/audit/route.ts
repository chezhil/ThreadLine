import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden } from "@/lib/accounts/http";
import { dayRange } from "@/lib/accounts/period";

// Additive, read-only route behind the audit trail page (not in the fixed
// contract list, which has no audit endpoint). Reads the shared AuditLog that
// every module writes through logAudit().
//
// GET ?entity=Order&action=status_change&userId=…&q=EVR-2610&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=50
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const sp = req.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? "1");
  const pageSize = Number(sp.get("pageSize") ?? "50");
  if (!Number.isInteger(page) || page < 1) return fieldErrorResponse({ page: ["page must be 1 or more"] });
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    return fieldErrorResponse({ pageSize: ["pageSize must be from 1 to 200"] });
  }
  const isDate = (v: string | null) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(from)) return fieldErrorResponse({ from: ["from must be YYYY-MM-DD"] });
  if (!isDate(to)) return fieldErrorResponse({ to: ["to must be YYYY-MM-DD"] });
  if (from && to && from > to) return fieldErrorResponse({ to: ["to must be on or after from"] });

  const q = sp.get("q")?.trim();
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.get("entity") ? { entity: sp.get("entity")! } : {}),
    ...(sp.get("action") ? { action: sp.get("action")! } : {}),
    ...(sp.get("userId") ? { userId: sp.get("userId")! } : {}),
    ...(from || to
      ? { at: { ...(from ? { gte: dayRange(from).start } : {}), ...(to ? { lt: dayRange(to).end } : {}) } }
      : {}),
    ...(q
      ? { OR: [{ entityId: { contains: q, mode: "insensitive" } }, { oldValue: { contains: q, mode: "insensitive" } }, { newValue: { contains: q, mode: "insensitive" } }] }
      : {}),
  };

  const [entries, total, entities, actions, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.user.findMany({ select: { id: true, name: true, role: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    entries: entries.map((e) => ({
      ...e,
      userName: userById.get(e.userId)?.name ?? null,
      userRole: userById.get(e.userId)?.role ?? null,
    })),
    total,
    page,
    pageSize,
    filters: {
      entities: entities.map((e) => e.entity),
      actions: actions.map((a) => a.action),
      users: users.map((u) => ({ id: u.id, name: u.name })),
    },
  });
}
