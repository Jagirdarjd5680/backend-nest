-- Assignment deadline relative to when it opens for each student (or none until the course ends).
ALTER TABLE "assignments" ADD COLUMN "deadlineMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "assignments" ADD COLUMN "deadlineDays" INTEGER;
