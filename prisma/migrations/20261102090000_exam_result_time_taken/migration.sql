-- AlterTable: how long the student took on an attempt (null for attempts recorded before this).
ALTER TABLE "exam_results" ADD COLUMN "timeTakenSeconds" INTEGER;
