"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Table, Badge, EmptyState, Drawer, Select, Pager } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { dateIN } from "@/lib/accounts/format";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";
import { ORDER_STATUSES } from "@/lib/tokens";
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

const PAGE_SIZE = 50;
const SORTS = [
  { value: "urgency", label: "Most urgent first" },
  { value: "deadline", label: "Deadline (soonest)" },
  { value: "newest", label: "Newest first" },
  { value: "value", label: "Order value (largest)" },
];

export function OrdersClient() {
  const router = useRouter();
  const buyers = useApi<{ buyers: PickBuyer[] }>("/api/buyers");
  const yarnTypes = useApi<{ yarnTypes: PickYarnType[] }>("/api/yarn-types");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("urgency");
  const [page, setPage] = useState(1);

  // Any filter/sort change starts back at page 1 — a stale page number past
  // the end of a newly-narrowed result set would just show an empty table.
  const setQAndResetPage = (next: string) => { setQ(next); setPage(1); };
  const setStatusAndResetPage = (next: string) => { setStatus(next); setPage(1); };
  const setSortAndResetPage = (next: string) => { setSort(next); setPage(1); };

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
  if (status) params.set("status", status);
  if (q.trim()) params.set("q", q.trim());
  const orders = useApi<{ orders: Order[]; total: number }>(`/api/orders?${params.toString()}`);

  useRealtimeEvent(RealtimeEvents.OrderStatus, () => orders.refetch());
  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (change.entity === "Order" || change.entity === "Buyer") orders.refetch();
  });

  const rows = orders.data?.orders ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Orders"
        subtitle="Each order has a buyer tracking link (no login) on its page."
        action={<Button onClick={() => setDrawerOpen(true)}>New order</Button>}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          aria-label="Search orders"
          placeholder="Search order no., buyer, fabric or status"
          value={q}
          onChange={(e) => setQAndResetPage(e.target.value)}
          className="sm:w-72"
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatusAndResetPage(e.target.value)}
          options={[{ value: "", label: "All statuses" }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]}
        />
        <Select aria-label="Sort by" value={sort} onChange={(e) => setSortAndResetPage(e.target.value)} options={SORTS} />
      </div>

      {orders.error && <ErrorNote message={`Couldn't load orders: ${orders.error}`} onRetry={orders.refetch} />}
      {orders.loading && !orders.data && <Loading />}
      {orders.data && (
        <>
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
            pageSize={false}
            keyFor={(o) => o.id}
            emptyState={
              <EmptyState
                title={orders.data.total ? "No orders match" : "No orders yet"}
                description={orders.data.total ? "Try another search or filter." : "Create the first one."}
              />
            }
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={orders.data.total} onPageChange={setPage} />
        </>
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
