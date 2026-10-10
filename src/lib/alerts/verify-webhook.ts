import crypto from "crypto";

/**
 * Validates HMAC-SHA256 signatures for Meta Cloud API webhook delivery receipts
 * (SENT, DELIVERED, READ) to prevent payload tampering and spoofed delivery statuses.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  const [algorithm, hash] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !hash) return false;

  const expectedHash = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "utf8");
  const expectedBuffer = Buffer.from(expectedHash, "utf8");

  if (hashBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, expectedBuffer);
}
