-- Assignments open by course progress / days since joining (like exams), not by date.
ALTER TABLE "exams" ADD COLUMN "unlockAfterDays" INTEGER;
ALTER TABLE "assignments" ADD COLUMN "unlockMode" TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE "assignments" ADD COLUMN "unlockAfterDays" INTEGER;
ALTER TABLE "assignments" ADD COLUMN "unlockAfterModules" INTEGER;
ALTER TABLE "assignments" ADD COLUMN "unlockModuleIndex" INTEGER;
