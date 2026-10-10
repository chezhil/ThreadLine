-- Delivery receipts from the WhatsApp Cloud API: the provider's message id (so
-- a webhook receipt can be matched back to its outbox row) and the furthest
-- receipt seen (DELIVERED / READ / FAILED).
ALTER TABLE "AlertDelivery" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "AlertDelivery" ADD COLUMN "receipt" TEXT;
ALTER TABLE "AlertDelivery" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "AlertDelivery" ADD COLUMN "readAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AlertDelivery_providerMessageId_key" ON "AlertDelivery"("providerMessageId");
