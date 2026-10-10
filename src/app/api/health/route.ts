import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const startTime = Date.now();

export async function GET(_req: NextRequest) {
  let dbHealthy = false;

  // 1. Check database connectivity
  try {
    await db.$queryRawUnsafe("SELECT 1");
    dbHealthy = true;
  } catch (err) {
    console.error("Health check DB probe failed:", err);
    dbHealthy = false;
  }

  // If DB is down, return 503 Service Unavailable immediately
  if (!dbHealthy) {
    return NextResponse.json(
      {
        status: "unhealthy",
        db: false,
        groq: false,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        error: "Database connectivity check failed",
      },
      { status: 503 }
    );
  }

  // 2. Groq is a paid cloud API, so this checks configuration, not a live
  // call — pinging it on every health check would burn quota for no reason.
  const groqConfigured = !!process.env.GROQ_API_KEY;

  return NextResponse.json({
    status: "healthy",
    db: true,
    groq: groqConfigured,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}
