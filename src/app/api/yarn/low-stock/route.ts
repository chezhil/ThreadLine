import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yarnTypes = await db.yarnType.findMany({ include: { lots: true } });

  const lowStock = yarnTypes
    .map((yt) => {
      const remainingKg = yt.lots.reduce((sum, lot) => sum + lot.qtyRemainingKg, 0);
      return {
        yarnTypeId: yt.id,
        name: yt.name,
        colour: yt.colour,
        remainingKg,
        lowStockThresholdKg: yt.lowStockThresholdKg,
      };
    })
    .filter((yt) => yt.remainingKg <= yt.lowStockThresholdKg);

  return NextResponse.json({ lowStock });
}
