import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30", 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch all rolls with QC records and relations
    const rolls = await db.roll.findMany({
      where: {
        qcRecords: {
          some: {
            inspectedAt: { gte: startDate },
          },
        },
      },
      include: {
        machine: true,
        yarnLot: {
          include: {
            yarnType: true,
            supplier: true,
          },
        },
        qcRecords: {
          where: {
            inspectedAt: { gte: startDate },
          },
          orderBy: { inspectedAt: "desc" },
        },
      },
    });

    const totalInspected = rolls.length;
    let totalPass = 0;
    let totalRework = 0;
    let totalReject = 0;

    // Aggregators
    const machineMap: Record<
      string,
      {
        id: string;
        name: string;
        type: string;
        total: number;
        pass: number;
        rework: number;
        reject: number;
        defects: Record<string, number>;
      }
    > = {};

    const shiftMap: Record<
      string,
      {
        shift: string;
        total: number;
        pass: number;
        rework: number;
        reject: number;
      }
    > = {};

    const yarnLotMap: Record<
      string,
      {
        id: string;
        lotNo: string;
        yarnTypeName: string;
        supplierName: string;
        total: number;
        pass: number;
        rework: number;
        reject: number;
      }
    > = {};

    const defectTypeCounts: Record<string, number> = {
      hole: 0,
      colour_mismatch: 0,
      uneven_weave: 0,
    };
    let totalDefectsCount = 0;

    for (const roll of rolls) {
      const latestQc = roll.qcRecords[0];
      const result = latestQc ? latestQc.result : roll.qcStatus;

      if (result === "PASS") totalPass++;
      else if (result === "REWORK") totalRework++;
      else if (result === "REJECT") totalReject++;

      // Machine stats
      if (!machineMap[roll.machineId]) {
        machineMap[roll.machineId] = {
          id: roll.machineId,
          name: roll.machine.name,
          type: roll.machine.type,
          total: 0,
          pass: 0,
          rework: 0,
          reject: 0,
          defects: {},
        };
      }
      machineMap[roll.machineId].total++;
      if (result === "PASS") machineMap[roll.machineId].pass++;
      if (result === "REWORK") machineMap[roll.machineId].rework++;
      if (result === "REJECT") machineMap[roll.machineId].reject++;

      // Shift stats
      if (!shiftMap[roll.shift]) {
        shiftMap[roll.shift] = {
          shift: roll.shift,
          total: 0,
          pass: 0,
          rework: 0,
          reject: 0,
        };
      }
      shiftMap[roll.shift].total++;
      if (result === "PASS") shiftMap[roll.shift].pass++;
      if (result === "REWORK") shiftMap[roll.shift].rework++;
      if (result === "REJECT") shiftMap[roll.shift].reject++;

      // YarnLot stats
      if (!yarnLotMap[roll.yarnLotId]) {
        yarnLotMap[roll.yarnLotId] = {
          id: roll.yarnLotId,
          lotNo: roll.yarnLot.lotNo,
          yarnTypeName: roll.yarnLot.yarnType.name,
          supplierName: roll.yarnLot.supplier.name,
          total: 0,
          pass: 0,
          rework: 0,
          reject: 0,
        };
      }
      yarnLotMap[roll.yarnLotId].total++;
      if (result === "PASS") yarnLotMap[roll.yarnLotId].pass++;
      if (result === "REWORK") yarnLotMap[roll.yarnLotId].rework++;
      if (result === "REJECT") yarnLotMap[roll.yarnLotId].reject++;

      // Parse defects
      if (latestQc && latestQc.defects) {
        try {
          const defectList: string[] = JSON.parse(latestQc.defects);
          for (const d of defectList) {
            defectTypeCounts[d] = (defectTypeCounts[d] || 0) + 1;
            totalDefectsCount++;

            machineMap[roll.machineId].defects[d] =
              (machineMap[roll.machineId].defects[d] || 0) + 1;
          }
        } catch {
          // ignore parsing error
        }
      }
    }

    // Machine array with rates
    const byMachine = Object.values(machineMap).map((m) => ({
      ...m,
      rejectRate: m.total > 0 ? (m.reject / m.total) * 100 : 0,
      shareOfTotalRejects: totalReject > 0 ? (m.reject / totalReject) * 100 : 0,
    })).sort((a, b) => b.reject - a.reject);

    // Shift array with rates
    const byShift = Object.values(shiftMap).map((s) => ({
      ...s,
      rejectRate: s.total > 0 ? (s.reject / s.total) * 100 : 0,
    })).sort((a, b) => b.rejectRate - a.rejectRate);

    // Yarn lot array with rates
    const byYarnLot = Object.values(yarnLotMap).map((y) => ({
      ...y,
      rejectRate: y.total > 0 ? (y.reject / y.total) * 100 : 0,
    })).sort((a, b) => b.rejectRate - a.rejectRate);

    // Defect types array
    const byDefectType = Object.entries(defectTypeCounts).map(([type, count]) => {
      const labels: Record<string, string> = {
        hole: "Hole",
        colour_mismatch: "Colour Mismatch",
        uneven_weave: "Uneven Weave",
      };
      return {
        type,
        label: labels[type] || type,
        count,
        percentage: totalDefectsCount > 0 ? (count / totalDefectsCount) * 100 : 0,
      };
    }).sort((a, b) => b.count - a.count);

    // Compute dynamic, query-driven plain-language callouts
    const callouts: string[] = [];

    if (totalInspected > 0) {
      // 1. Worst machine callout
      const worstMachine = byMachine[0];
      if (worstMachine && worstMachine.reject > 0 && totalReject > 0) {
        const share = Math.round(worstMachine.shareOfTotalRejects);
        callouts.push(
          `${worstMachine.name} produced ${share}% of all rejects this period (${worstMachine.reject} of ${totalReject} rejects).`
        );
      }

      // 2. Worst shift callout
      const worstShift = byShift[0];
      if (worstShift && worstShift.reject > 0) {
        callouts.push(
          `${worstShift.shift} shift recorded the highest rejection rate at ${worstShift.rejectRate.toFixed(1)}% (${worstShift.reject} rejects from ${worstShift.total} rolls).`
        );
      }

      // 3. Primary defect cause callout
      const topDefect = byDefectType[0];
      if (topDefect && topDefect.count > 0) {
        callouts.push(
          `"${topDefect.label}" is the leading defect cause, accounting for ${topDefect.percentage.toFixed(1)}% of all identified issues (${topDefect.count} occurrences).`
        );
      }

      // 4. Yarn Lot impact callout
      const worstLot = byYarnLot[0];
      if (worstLot && worstLot.reject > 0 && worstLot.rejectRate > 15) {
        callouts.push(
          `Yarn Lot ${worstLot.lotNo} (${worstLot.yarnTypeName} from ${worstLot.supplierName}) exhibited an elevated defect rate of ${worstLot.rejectRate.toFixed(1)}%.`
        );
      }
    } else {
      callouts.push("No inspection records found for the selected time period.");
    }

    return NextResponse.json({
      timeframeDays: days,
      summary: {
        totalInspected,
        totalPass,
        totalRework,
        totalReject,
        passRate: totalInspected > 0 ? (totalPass / totalInspected) * 100 : 0,
        reworkRate: totalInspected > 0 ? (totalRework / totalInspected) * 100 : 0,
        rejectRate: totalInspected > 0 ? (totalReject / totalInspected) * 100 : 0,
      },
      callouts,
      byMachine,
      byShift,
      byYarnLot,
      byDefectType,
    });
  } catch (err: any) {
    console.error("Failed to generate defect analytics:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
