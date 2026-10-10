import type { Role } from "./auth";

// Where each role lands after signing in, and where the ThreadLine logo takes
// them. A plain module (no server-only imports) so client components can use it.
export const ROLE_HOME: Record<Role, string> = {
  owner: "/dashboard",
  storekeeper: "/inventory",
  floor_supervisor: "/production/floor-board",
  qc_inspector: "/quality/qc",
};
