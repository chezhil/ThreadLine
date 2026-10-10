-- Attendance keeps the wage that applied on the day it was marked.
ALTER TABLE "Attendance" ADD COLUMN "dailyWage" REAL;
UPDATE "Attendance" SET "dailyWage" = (SELECT "dailyWage" FROM "Worker" WHERE "Worker"."id" = "Attendance"."workerId");

-- One mark per worker, day and shift. Concurrent muster saves could insert
-- two; keep the earliest row of any such pair before adding the constraint.
DELETE FROM "Attendance" WHERE "rowid" NOT IN (
    SELECT MIN("rowid") FROM "Attendance" GROUP BY "workerId", "date", "shift"
);
CREATE UNIQUE INDEX "Attendance_workerId_date_shift_key" ON "Attendance"("workerId", "date", "shift");

-- Per-user read marks for notifications.
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("notificationId", "userId"),
    CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");
