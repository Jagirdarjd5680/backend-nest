-- Event ticket check-in (QR scanner): when a ticket was scanned and by whom.
ALTER TABLE "event_bookings" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "event_bookings" ADD COLUMN "checkedInById" INTEGER;
