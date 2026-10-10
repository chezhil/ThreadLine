import { getSession } from "@/lib/auth";
import { problem } from "./http";

// The foundation's shared auth helper owns session verification. Keep the
// production routes' role policy in one place.
export async function productionActor() {
  const session = await getSession();
  const user = session?.user;
  if (!user) return { response: problem("Sign in to continue", 401) } as const;
  if (user.role !== "owner" && user.role !== "floor_supervisor") {
    return { response: problem("You cannot manage production", 403) } as const;
  }
  return { user } as const;
}
