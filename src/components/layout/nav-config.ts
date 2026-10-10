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

// Mobile bottom tab bar shows only the role's top 4 actions.
export const MOBILE_TOP_ACTIONS: Record<Role, string[]> = {
  owner: ["/dashboard", "/orders", "/production/floor-board", "/accounts"],
  storekeeper: ["/inventory", "/dispatch", "/alerts", "/orders"],
  floor_supervisor: ["/production/floor-board", "/production/work-orders", "/alerts", "/orders"],
  qc_inspector: ["/quality/qc", "/quality/rolls", "/alerts", "/orders"],
};
