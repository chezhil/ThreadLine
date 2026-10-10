import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { forbidden } from "@/lib/accounts/http";
import { IMPORT_TARGETS } from "@/lib/import/targets";

export async function GET() {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const targets = IMPORT_TARGETS.map(({ key, label, description, fields }) => ({ key, label, description, fields }));
  return NextResponse.json({ targets });
}
