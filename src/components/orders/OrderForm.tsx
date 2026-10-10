"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui";
import { postJson } from "@/lib/useApi";
import { orderCreateSchema, orderUpdateSchema } from "@/lib/validation/order";
import { useZodForm } from "@/components/accounts/useZodForm";
import type { FeasibilityStatus } from "@/lib/feasibility";

export interface PickBuyer {
  id: string;
  name: string;
  archivedAt: string | null;
}
export interface PickYarnType {
  id: string;
  name: string;
  colour: string;
  archivedAt: string | null;
}

/** The fields of an order this form edits. */
export interface EditableOrder {
  id: string;
  buyerId: string;
  fabricType: string;
  colour: string;
  gsm: number;
  qtyMetres: number;
  pricePerMetre: number;
  deadline: string;
}

const FEASIBILITY_BADGE: Record<FeasibilityStatus, string> = {
  FEASIBLE: "pass",
  FEASIBLE_IF: "rework",
  DEADLINE_NOT_REALISTIC: "reject",
};

/** A deadline instant as the mill's calendar date, for a date input. */
const deadlineDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * New order, or a correction of one that is still NEW or CONFIRMED. An edit
 * sends only what changed; changing quantity, GSM or deadline re-runs the
 * stored feasibility check on the server.
 */
export function OrderForm({
  order,
  buyers,
  yarnTypes,
  onSaved,
}: {
  order: EditableOrder | null;
  buyers: PickBuyer[];
  yarnTypes: PickYarnType[];
  onSaved: (orderId: string) => void;
}) {
  const form = useZodForm(order ? orderUpdateSchema : orderCreateSchema, {
    buyerId: order?.buyerId ?? "",
    fabricType: order?.fabricType ?? "",
    colour: order?.colour ?? "",
    gsm: order ? String(order.gsm) : "",
    qtyMetres: order ? String(order.qtyMetres) : "",
    pricePerMetre: order ? String(order.pricePerMetre) : "",
    deadline: order ? deadlineDay(order.deadline) : "",
    yarnTypeId: "",
    wastagePct: order ? "" : "8",
  });
  const [feasibility, setFeasibility] = useState<{ status: FeasibilityStatus; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Archived buyers and yarns can't start new work, but an order keeps its own.
  const buyerOptions = buyers.filter((b) => !b.archivedAt || b.id === order?.buyerId).map((b) => ({ value: b.id, label: b.name }));
  const yarnOptions = yarnTypes.filter((y) => !y.archivedAt).map((y) => ({ value: y.id, label: `${y.name} — ${y.colour}` }));

  async function checkFeasibility() {
    setChecking(true);
    const { ok, data, fieldErrors } = await postJson<{ status: FeasibilityStatus; message: string }>("/api/orders/feasibility", {
      fabricType: form.values.fabricType,
      gsm: form.values.gsm,
      qtyMetres: form.values.qtyMetres,
      deadline: form.values.deadline,
      wastagePct: form.values.wastagePct || undefined,
      yarnTypeId: form.values.yarnTypeId,
    });
    setChecking(false);
    if (!ok) {
      form.setErrors(fieldErrors ?? { _form: ["Couldn't run the feasibility check"] });
      return;
    }
    setFeasibility(data);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = order ? form.changed() : form.values;
    if (order && Object.keys(body).length === 0) return onSaved(order.id);
    if (!form.validate(body)) return;
    form.setSubmitting(true);
    const res = await postJson<{ order: { id: string } }>(order ? `/api/orders/${order.id}` : "/api/orders", body, order ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the order"] });
      return;
    }
    onSaved(res.data.order.id);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Select label="Buyer" name="buyerId" options={buyerOptions} placeholder="Select buyer" {...form.field("buyerId")} />
      <Input label="Fabric type" name="fabricType" maxLength={60} {...form.field("fabricType")} />
      <Input label="Colour" name="colour" maxLength={60} {...form.field("colour")} />
      <Input label="GSM" name="gsm" type="number" min="20" max="2000" step="1" inputMode="numeric" {...form.field("gsm")} />
      <Input label="Quantity (metres)" name="qtyMetres" type="number" min="0" step="any" inputMode="decimal" {...form.field("qtyMetres")} />
      <Input label="Price per metre (₹)" name="pricePerMetre" type="number" min="0" step="0.01" inputMode="decimal" {...form.field("pricePerMetre")} />
      <Input label="Deadline" name="deadline" type="date" {...form.field("deadline")} />

      <Card className="bg-gray-50">
        <CardHeader title={order ? "Re-check feasibility (optional)" : "Feasibility check"} />
        <div className="flex flex-col gap-3">
          <Select
            label="Yarn type to check against"
            name="yarnTypeId"
            options={[{ value: "", label: order ? "Keep the yarn it was checked against" : "Don't check" }, ...yarnOptions]}
            {...form.field("yarnTypeId")}
          />
          <Input label="Wastage %" name="wastagePct" type="number" min="0" max="100" step="any" placeholder={order ? "Unchanged" : undefined} {...form.field("wastagePct")} />
          <Button type="button" variant="secondary" onClick={checkFeasibility} disabled={checking || !form.values.yarnTypeId}>
            {checking ? "Checking…" : "Check feasibility"}
          </Button>
          {feasibility && (
            <div role="status" className="flex items-start gap-2 text-sm">
              <Badge status={FEASIBILITY_BADGE[feasibility.status]}>{feasibility.status.replace(/_/g, " ").toLowerCase()}</Badge>
              <span>{feasibility.message}</span>
            </div>
          )}
        </div>
      </Card>

      {form.errors._form && <p role="alert" className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : order ? "Save changes" : "Create order"}
      </Button>
    </form>
  );
}
