-- Course exams open by course progress instead of by date, and can serve a subset of their questions.
ALTER TABLE "exams" ADD COLUMN "unlockMode" TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE "exams" ADD COLUMN "unlockAfterModules" INTEGER;
ALTER TABLE "exams" ADD COLUMN "unlockModuleIndex" INTEGER;
ALTER TABLE "exams" ADD COLUMN "questionCount" INTEGER;
