-- All watch time ever spent on a lecture, rewatches included (watchedSeconds stays capped at the
-- lecture length). Course progress is measured against the course's Estimated Reading Time.
ALTER TABLE "lecture_progress" ADD COLUMN "totalWatchedSeconds" INTEGER NOT NULL DEFAULT 0;
UPDATE "lecture_progress" SET "totalWatchedSeconds" = "watchedSeconds";
