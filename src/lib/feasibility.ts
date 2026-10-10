import { db } from "./db";
import { totalRemainingKg } from "./inventory";

// Assumed loom width in metres — the mill runs one standard width. Documented
// here rather than hidden in a magic number so the formula stays auditable.
const ASSUMED_FABRIC_WIDTH_METRES = 1.5;
const SHIFTS_PER_DAY = 2;

export interface FeasibilityInput {
  gsm: number;
  qtyMetres: number;
  deadline: Date;
  wastagePct: number;
  yarnTypeId: string;
}

export type FeasibilityStatus = "FEASIBLE" | "FEASIBLE_IF" | "DEADLINE_NOT_REALISTIC";

export interface FeasibilityResult {
  status: FeasibilityStatus;
  message: string;
  yarnNeededKg: number;
  yarnAvailableKg: number;
  shortfallKg: number;
  capacityAvailableMetres: number;
}

export async function checkFeasibility(input: FeasibilityInput): Promise<FeasibilityResult> {
  const { gsm, qtyMetres, deadline, wastagePct, yarnTypeId } = input;

  const baseYarnKg = (qtyMetres * gsm * ASSUMED_FABRIC_WIDTH_METRES) / 1000;
  const yarnNeededKg = baseYarnKg * (1 + wastagePct / 100);

  const yarnAvailableKg = await totalRemainingKg(yarnTypeId);
  const shortfallKg = Math.max(0, yarnNeededKg - yarnAvailableKg);

  const machines = await db.machine.findMany({
    where: { status: { in: ["RUNNING", "IDLE"] } },
    select: { capacityMetresPerShift: true },
  });
  const capacityPerShift = machines.reduce((sum, m) => sum + m.capacityMetresPerShift, 0);

  const daysUntilDeadline = Math.max(
    0,
    Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
  const capacityAvailableMetres = capacityPerShift * SHIFTS_PER_DAY * daysUntilDeadline;

  if (capacityAvailableMetres < qtyMetres) {
    return {
      status: "DEADLINE_NOT_REALISTIC",
      message: `DEADLINE NOT REALISTIC: available machine capacity by the deadline is ~${Math.round(
        capacityAvailableMetres,
      )}m across ${machines.length} usable machine(s), but the order needs ${qtyMetres}m.`,
      yarnNeededKg,
      yarnAvailableKg,
      shortfallKg,
      capacityAvailableMetres,
    };
  }

  if (shortfallKg > 0) {
    return {
      status: "FEASIBLE_IF",
      message: `FEASIBLE IF you order ${shortfallKg.toFixed(1)}kg more yarn (need ${yarnNeededKg.toFixed(
        1,
      )}kg including ${wastagePct}% wastage, have ${yarnAvailableKg.toFixed(1)}kg).`,
      yarnNeededKg,
      yarnAvailableKg,
      shortfallKg,
      capacityAvailableMetres,
    };
  }

  return {
    status: "FEASIBLE",
    message: `FEASIBLE: ${yarnNeededKg.toFixed(1)}kg yarn available and machine capacity (~${Math.round(
      capacityAvailableMetres,
    )}m by deadline) covers the order.`,
    yarnNeededKg,
    yarnAvailableKg,
    shortfallKg,
    capacityAvailableMetres,
  };
}
