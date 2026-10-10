-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "YarnType" ADD COLUMN "archivedAt" DATETIME;

-- CreateTable
CREATE TABLE "Reversal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "invoiceId" TEXT,
    "qcRecordId" TEXT,
    "reason" TEXT NOT NULL,
    "replacementId" TEXT,
    "reversedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reversal_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reversal_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reversal_qcRecordId_fkey" FOREIGN KEY ("qcRecordId") REFERENCES "QCRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Reversal_paymentId_key" ON "Reversal"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Reversal_expenseId_key" ON "Reversal"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Reversal_invoiceId_key" ON "Reversal"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Reversal_qcRecordId_key" ON "Reversal"("qcRecordId");
