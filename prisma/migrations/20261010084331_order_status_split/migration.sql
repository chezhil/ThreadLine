-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "fabricType" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "gsm" INTEGER NOT NULL,
    "qtyMetres" REAL NOT NULL,
    "pricePerMetre" REAL NOT NULL,
    "deadline" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "productionStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "qcStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "dispatchStatus" TEXT NOT NULL DEFAULT 'NOT_DISPATCHED',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "trackingToken" TEXT NOT NULL,
    "feasibilityResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("buyerId", "colour", "createdAt", "deadline", "fabricType", "feasibilityResult", "gsm", "id", "orderNo", "pricePerMetre", "qtyMetres", "status", "trackingToken") SELECT "buyerId", "colour", "createdAt", "deadline", "fabricType", "feasibilityResult", "gsm", "id", "orderNo", "pricePerMetre", "qtyMetres", "status", "trackingToken" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Best-effort backfill from the legacy `status` value, so existing rows
-- aren't all left at the column defaults regardless of how far along they
-- actually are. This is necessarily approximate (it can't know about partial
-- dispatch or partial payment from `status` alone) — anything running after
-- this migration should follow up with a real recompute from Roll/Invoice/
-- Payment rows (see src/lib/order-status.ts) for full accuracy; the app's
-- seed script does this for its own data.
UPDATE "Order" SET
  "productionStatus" = CASE
    WHEN "status" IN ('NEW', 'CONFIRMED') THEN 'NOT_STARTED'
    WHEN "status" = 'IN_PRODUCTION' THEN 'IN_PRODUCTION'
    ELSE 'DONE'
  END,
  "qcStatus" = CASE
    WHEN "status" IN ('NEW', 'CONFIRMED', 'IN_PRODUCTION') THEN 'PENDING'
    ELSE 'PASS'
  END,
  "dispatchStatus" = CASE
    WHEN "status" IN ('DISPATCHED', 'CLOSED') THEN 'FULLY_DISPATCHED'
    ELSE 'NOT_DISPATCHED'
  END;
