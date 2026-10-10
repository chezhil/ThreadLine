import { db } from "./db";
import { totalRemainingKg } from "./inventory";

// Assumed loom width in metres — the mill runs one standard width. Documented
// here rather than hidden in a magic number so the formula stays auditable.
const ASSUMED_FABRIC_WIDTH_METRES = 1.5;
const SHIFTS_PER_DAY = 2;
const STAGE_MACHINE_TYPES = ["spinning", "loom", "dyeing"] as const;

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

const DEFAULT_WASTAGE_PCT = 8;

/** What Order.feasibilityResult holds: the verdict plus the inputs needed to
 * re-run it when the order is edited. */
export interface StoredFeasibility extends FeasibilityResult {
  yarnTypeId: string;
  wastagePct: number;
  checkedAt: string;
}

/** Runs the check for an order being saved and returns the JSON to store. */
export async function storedFeasibility(order: {
  gsm: number;
  qtyMetres: number;
  deadline: Date;
  yarnTypeId: string;
  wastagePct?: number;
}): Promise<string> {
  const wastagePct = order.wastagePct ?? DEFAULT_WASTAGE_PCT;
  const result = await checkFeasibility({ ...order, wastagePct });
  const stored: StoredFeasibility = { ...result, yarnTypeId: order.yarnTypeId, wastagePct, checkedAt: new Date().toISOString() };
  return JSON.stringify(stored);
}

/** The yarn type and wastage a stored result was computed with, if it is one
 * this app wrote (older rows may hold plain text). */
export function storedFeasibilityInputs(raw: string | null): { yarnTypeId: string; wastagePct: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFeasibility>;
    if (typeof parsed.yarnTypeId !== "string") return null;
    return { yarnTypeId: parsed.yarnTypeId, wastagePct: typeof parsed.wastagePct === "number" ? parsed.wastagePct : DEFAULT_WASTAGE_PCT };
  } catch {
    return null;
  }
}

export async function checkFeasibility(input: FeasibilityInput): Promise<FeasibilityResult> {
  const { gsm, qtyMetres, deadline, wastagePct, yarnTypeId } = input;

  const baseYarnKg = (qtyMetres * gsm * ASSUMED_FABRIC_WIDTH_METRES) / 1000;
  const yarnNeededKg = baseYarnKg * (1 + wastagePct / 100);

  const yarnAvailableKg = await totalRemainingKg(yarnTypeId);
  const shortfallKg = Math.max(0, yarnNeededKg - yarnAvailableKg);

  // Cloth passes spinning → weaving (looms) → dyeing, so the mill's
  // throughput is that of its slowest stage, not the sum of every machine.
  const machines = await db.machine.findMany({
    where: { status: { in: ["RUNNING", "IDLE"] } },
    select: { type: true, capacityMetresPerShift: true },
  });
  const perStage = STAGE_MACHINE_TYPES.map((type) => ({
    type,
    capacity: machines.filter((m) => m.type === type).reduce((sum, m) => sum + m.capacityMetresPerShift, 0),
  }));
  const bottleneck = perStage.reduce((min, s) => (s.capacity < min.capacity ? s : min));
  const capacityPerShift = bottleneck.capacity;

  const daysUntilDeadline = Math.max(
    0,
    Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
  const capacityAvailableMetres = capacityPerShift * SHIFTS_PER_DAY * daysUntilDeadline;

  if (capacityAvailableMetres < qtyMetres) {
    return {
      status: "DEADLINE_NOT_REALISTIC",
      message: `DEADLINE NOT REALISTIC: by the deadline the mill can put ~${Math.round(
        capacityAvailableMetres,
      )}m through every stage (${bottleneck.type} is the bottleneck${
        bottleneck.capacity === 0 ? ", with no usable machine" : ""
      }), but the order needs ${qtyMetres}m.`,
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
