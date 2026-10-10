import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  href: string;
  roles: Role[];
}

// Grouped as the spec requires: Dashboard, Orders, Production, Quality,
// Inventory, Dispatch, Accounts, Alerts, Assistant. Each module owns the pages
// behind its own items — this file only controls visibility, add your item
// here when your route exists, don't remove another module's item.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", roles: ["owner"] },
  { label: "Orders", href: "/orders", roles: ["owner"] },
  { label: "Production", href: "/production/floor-board", roles: ["owner", "floor_supervisor"] },
  { label: "Quality", href: "/quality/qc", roles: ["owner", "qc_inspector"] },
  { label: "Inventory", href: "/inventory", roles: ["owner", "storekeeper"] },
  { label: "Dispatch", href: "/dispatch", roles: ["owner", "storekeeper"] },
  { label: "Accounts", href: "/accounts", roles: ["owner"] },
  { label: "Approvals", href: "/approvals", roles: ["owner"] },
  { label: "Alerts", href: "/alerts", roles: ["owner", "storekeeper", "floor_supervisor", "qc_inspector"] },
  { label: "Assistant", href: "/assistant", roles: ["owner"] },
  { label: "Audit trail", href: "/audit", roles: ["owner"] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

// Mobile bottom tab bar shows only the role's top actions — every one a page
// that role can actually open (sub-pages carry their own labels).
export const MOBILE_TOP_ACTIONS: Record<Role, { label: string; href: string }[]> = {
  owner: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Orders", href: "/orders" },
    { label: "Production", href: "/production/floor-board" },
    { label: "Accounts", href: "/accounts" },
  ],
  storekeeper: [
    { label: "Inventory", href: "/inventory" },
    { label: "Dispatch", href: "/dispatch" },
    { label: "Alerts", href: "/alerts" },
  ],
  floor_supervisor: [
    { label: "Floor board", href: "/production/floor-board" },
    { label: "Work orders", href: "/production/work-orders" },
    { label: "Machines", href: "/production/machines" },
    { label: "Alerts", href: "/alerts" },
  ],
  qc_inspector: [
    { label: "QC queue", href: "/quality/qc" },
    { label: "Rolls", href: "/quality/rolls" },
    { label: "Defects", href: "/quality/defects" },
    { label: "Alerts", href: "/alerts" },
  ],
};
