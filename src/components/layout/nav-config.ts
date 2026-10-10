import type { LucideIcon } from "lucide-react";
import {
  Bot,
  ClipboardCheck,
  Factory,
  Landmark,
  LayoutDashboard,
  Package,
  ScrollText,
  Siren,
  Stamp,
  Truck,
  ClipboardList,
} from "lucide-react";
import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  /** Shorter name for the header title and breadcrumbs. */
  short: string;
  href: string;
  roles: Role[];
  icon: LucideIcon;
  group: "mill" | "control";
}

// Grouped as the spec requires: Dashboard, Orders, Production, Quality,
// Inventory, Dispatch, Accounts, Alerts, Assistant. Each module owns the pages
// behind its own items — this file only controls visibility, add your item
// here when your route exists, don't remove another module's item.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", short: "Owner Executive Dashboard", href: "/dashboard", roles: ["owner"], icon: LayoutDashboard, group: "mill" },
  { label: "Orders & Buyers", short: "Orders", href: "/orders", roles: ["owner"], icon: ClipboardList, group: "mill" },
  { label: "Production (Looms)", short: "Production", href: "/production/floor-board", roles: ["owner", "floor_supervisor"], icon: Factory, group: "mill" },
  { label: "Quality & QC", short: "Quality", href: "/quality/qc", roles: ["owner", "qc_inspector"], icon: ClipboardCheck, group: "mill" },
  { label: "Yarn & Inventory", short: "Inventory", href: "/inventory", roles: ["owner", "storekeeper"], icon: Package, group: "mill" },
  { label: "Dispatch", short: "Dispatch", href: "/dispatch", roles: ["owner", "storekeeper"], icon: Truck, group: "mill" },
  { label: "Accounts & Margins", short: "Accounts", href: "/accounts", roles: ["owner"], icon: Landmark, group: "control" },
  { label: "Approvals", short: "Approvals", href: "/approvals", roles: ["owner"], icon: Stamp, group: "control" },
  { label: "Mill Alerts", short: "Alerts", href: "/alerts", roles: ["owner", "storekeeper", "floor_supervisor", "qc_inspector"], icon: Siren, group: "control" },
  { label: "AI Query Assistant", short: "Assistant", href: "/assistant", roles: ["owner"], icon: Bot, group: "control" },
  { label: "Audit Trail", short: "Audit Trail", href: "/audit", roles: ["owner"], icon: ScrollText, group: "control" },
];

export const NAV_GROUP_LABEL: Record<NavItem["group"], string> = {
  mill: "Mill Navigation",
  control: "Control Room",
};

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** The module a path belongs to — its nav item's first path segment. */
export function navItemForPath(pathname: string): NavItem | undefined {
  const section = pathname.split("/").filter(Boolean)[0];
  return NAV_ITEMS.find((item) => item.href.split("/").filter(Boolean)[0] === section);
}

export const ROLE_LABEL: Record<Role, { title: string; tag: string }> = {
  owner: { title: "Mill Owner", tag: "OWNER" },
  storekeeper: { title: "Storekeeper", tag: "STORE" },
  floor_supervisor: { title: "Floor Supervisor", tag: "FLOOR" },
  qc_inspector: { title: "QC Inspector", tag: "QC" },
};

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

// Mobile bottom tab bar shows only the role's top actions — every one a page
// that role can actually open (sub-pages carry their own labels).
export const MOBILE_TOP_ACTIONS: Record<Role, { label: string; href: string; icon: LucideIcon }[]> = {
  owner: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Orders", href: "/orders", icon: ClipboardList },
    { label: "Production", href: "/production/floor-board", icon: Factory },
    { label: "Accounts", href: "/accounts", icon: Landmark },
    { label: "Alerts", href: "/alerts", icon: Siren },
  ],
  storekeeper: [
    { label: "Inventory", href: "/inventory", icon: Package },
    { label: "Dispatch", href: "/dispatch", icon: Truck },
    { label: "Alerts", href: "/alerts", icon: Siren },
  ],
  floor_supervisor: [
    { label: "Floor board", href: "/production/floor-board", icon: Factory },
    { label: "Work orders", href: "/production/work-orders", icon: ClipboardList },
    { label: "Machines", href: "/production/machines", icon: Factory },
    { label: "Alerts", href: "/alerts", icon: Siren },
  ],
  qc_inspector: [
    { label: "QC queue", href: "/quality/qc", icon: ClipboardCheck },
    { label: "Rolls", href: "/quality/rolls", icon: Package },
    { label: "Defects", href: "/quality/defects", icon: ScrollText },
    { label: "Alerts", href: "/alerts", icon: Siren },
  ],
};
