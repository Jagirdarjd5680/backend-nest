-- Face ID change requests (student asks, admin approves once).
ALTER TABLE "users" ADD COLUMN "faceChangeStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "users" ADD COLUMN "faceChangeRequestedAt" TIMESTAMP(3);
