"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Table, Badge, EmptyState, Drawer } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { dateIN } from "@/lib/accounts/format";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";
import { OrderForm, type PickBuyer, type PickYarnType } from "./OrderForm";

interface Order {
  id: string;
  orderNo: string;
  buyer: { name: string };
  fabricType: string;
  colour: string;
  gsm: number;
  qtyMetres: number;
  pricePerMetre: number;
  deadline: string;
  status: string;
}

export function OrdersClient() {
  const router = useRouter();
  const orders = useApi<{ orders: Order[] }>("/api/orders");
  const buyers = useApi<{ buyers: PickBuyer[] }>("/api/buyers");
  const yarnTypes = useApi<{ yarnTypes: PickYarnType[] }>("/api/yarn-types");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState("");

  useRealtimeEvent(RealtimeEvents.OrderStatus, () => orders.refetch());
  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (change.entity === "Order" || change.entity === "Buyer") orders.refetch();
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders.data?.orders ?? []).filter(
      (o) => !needle || [o.orderNo, o.buyer.name, o.fabricType, o.colour, o.status].some((s) => s.toLowerCase().includes(needle)),
    );
  }, [orders.data, q]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Orders"
        subtitle="Each order has a buyer tracking link (no login) on its page."
        action={<Button onClick={() => setDrawerOpen(true)}>New order</Button>}
      />
      <Input aria-label="Search orders" placeholder="Search order no., buyer, fabric or status" value={q} onChange={(e) => setQ(e.target.value)} />

      {orders.error && <ErrorNote message={`Couldn't load orders: ${orders.error}`} onRetry={orders.refetch} />}
      {orders.loading && !orders.data && <Loading />}
      {orders.data && (
        <Table
          columns={[
            {
              header: "Order #",
              render: (o: Order) => (
                <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                  {o.orderNo}
                </Link>
              ),
            },
            { header: "Buyer", render: (o) => o.buyer.name },
            { header: "Fabric", render: (o) => `${o.fabricType} · ${o.colour} · ${o.gsm}gsm` },
            { header: "Qty (m)", className: "text-right tabular-nums", render: (o) => o.qtyMetres },
            { header: "Deadline", render: (o) => dateIN(o.deadline) },
            { header: "Status", render: (o) => <Badge status={o.status} /> },
          ]}
          rows={rows}
          keyFor={(o) => o.id}
          emptyState={
            <EmptyState
              title={orders.data.orders.length ? "No orders match" : "No orders yet"}
              description={orders.data.orders.length ? "Try another search." : "Create the first one."}
            />
          }
        />
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New order">
        {drawerOpen && (buyers.error || yarnTypes.error) && (
          <ErrorNote message={`Couldn't load buyers or yarn types: ${buyers.error ?? yarnTypes.error}`} onRetry={() => { buyers.refetch(); yarnTypes.refetch(); }} />
        )}
        {drawerOpen && buyers.data && yarnTypes.data && (
          <OrderForm
            order={null}
            buyers={buyers.data.buyers}
            yarnTypes={yarnTypes.data.yarnTypes}
            onSaved={(id) => {
              setDrawerOpen(false);
              router.push(`/orders/${id}`);
            }}
          />
        )}
        {drawerOpen && buyers.data?.buyers.filter((b) => !b.archivedAt).length === 0 && (
          <p className="mt-3 text-sm text-gray-600">
            No buyers yet — <Link href="/orders/buyers" className="font-medium text-brand hover:underline">add one</Link> first.
          </p>
        )}
      </Drawer>
    </div>
  );
}
