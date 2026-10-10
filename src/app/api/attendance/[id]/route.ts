import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { forbidden, notFound } from "@/lib/accounts/http";
import { istMonthKey, monthLabel } from "@/lib/accounts/period";
import { attendanceLocked } from "@/lib/accounts/summary";
import { inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

// DELETE — removes a mark made by mistake (owner only; status and machine are
// corrected by saving the muster sheet again). Not in a month whose wages have
// been paid out.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const mark = await tx.attendance.findUnique({ where: { id } });
    if (!mark) return { status: "missing" as const };
    const month = istMonthKey(mark.date);
    if (await attendanceLocked(month, tx)) return { status: "locked" as const, month };
    await tx.attendance.delete({ where: { id } });
    return { status: "deleted" as const, mark };
  });
  if (result.status === "missing") return notFound("Attendance mark not found");
  if (result.status === "locked") {
    return inUse(`Wages for ${monthLabel(result.month)} have been paid out, so its attendance is locked.`);
  }

  await logAudit("Attendance", id, "delete", result.mark, null, user.id);
  emitDataChanged({ entity: "Attendance", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
