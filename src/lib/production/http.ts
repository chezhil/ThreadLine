import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function fieldError(error: ZodError) {
  return NextResponse.json({ fieldErrors: error.flatten().fieldErrors }, { status: 400 });
}

export function problem(message: string, status = 400, field?: string) {
  return NextResponse.json(
    field ? { fieldErrors: { [field]: [message] } } : { error: message },
    { status },
  );
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
