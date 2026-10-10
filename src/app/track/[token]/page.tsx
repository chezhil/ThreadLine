import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export const instant = false;

const STAGES = [
  { key: "NEW", label: "Order placed" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "IN_PRODUCTION", label: "Weaving / dyeing" },
  { key: "QC", label: "Quality check" },
  { key: "READY", label: "Ready" },
  { key: "DISPATCHED", label: "Dispatched" },
  { key: "CLOSED", label: "Delivered" },
];

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const order = await db.order.findUnique({
    where: { trackingToken: token },
    include: { buyer: { select: { name: true } }, rolls: { select: { qcStatus: true, dispatchId: true } } },
  });

  if (!order) notFound();

  const stageIdx = STAGES.findIndex((s) => s.key === order.status);
  const rollsTotal = order.rolls.length;
  const rollsReady = order.rolls.filter((r) => r.qcStatus === "PASS").length;
  const rollsShipped = order.rolls.filter((r) => r.dispatchId).length;

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-center text-xl font-semibold text-foreground">ThreadLine</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Order {order.orderNo}</p>

        <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm text-gray-500">Buyer</p>
          <p className="mb-4 font-medium">{order.buyer.name}</p>

          <p className="mb-1 text-sm text-gray-500">Fabric</p>
          <p className="mb-4 font-medium">
            {order.fabricType} · {order.colour} · {order.gsm}gsm · {order.qtyMetres}m
          </p>

          <p className="mb-2 text-sm text-gray-500">Progress</p>
          <ol className="mb-4 flex flex-col gap-2">
            {STAGES.map((stage, i) => (
              <li key={stage.key} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    i <= stageIdx ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
                <span className={i <= stageIdx ? "font-medium text-foreground" : "text-gray-400"}>
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>

          <p className="mb-1 text-sm text-gray-500">Rolls passed quality check</p>
          <p className="mb-4 font-medium">
            {rollsReady} / {rollsTotal}
          </p>

          {rollsShipped > 0 && (
            <>
              <p className="mb-1 text-sm text-gray-500">Rolls shipped</p>
              <p className="mb-4 font-medium">
                {rollsShipped} / {rollsTotal}
                {order.dispatchStatus === "PARTIALLY_DISPATCHED" ? " (part shipment, more to follow)" : ""}
              </p>
            </>
          )}

          <p className="mb-1 text-sm text-gray-500">Estimated delivery</p>
          <p className="font-medium">
            {order.deadline.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}
