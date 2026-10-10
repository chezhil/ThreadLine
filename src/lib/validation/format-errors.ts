import { ZodError } from "zod";
import { NextResponse } from "next/server";

export function handleZodError(error: ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "form";
    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return NextResponse.json({ fieldErrors, error: "Validation failed" }, { status: 400 });
}
