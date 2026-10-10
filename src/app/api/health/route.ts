import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const startTime = Date.now();

export async function GET(_req: NextRequest) {
  let dbHealthy = false;
  let ollamaHealthy = false;

  // 1. Check SQLite connectivity
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
        ollama: false,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        error: "Database connectivity check failed",
      },
      { status: 503 }
    );
  }

  // 2. Check Ollama reachability (timeout 1000ms)
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${ollamaUrl}/api/version`, {
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    if (res && res.ok) {
      ollamaHealthy = true;
    }
  } catch {
    ollamaHealthy = false;
  }

  return NextResponse.json({
    status: "healthy",
    db: true,
    ollama: ollamaHealthy,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}
