-- In-progress exam attempt state, so leaving mid-exam and resuming (even on a
-- different device) restores answers/marked-for-review/visited/current question.
CREATE TABLE `exam_progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `examId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `answers` JSON NULL,
    `marked` JSON NULL,
    `visited` JSON NULL,
    `currentIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exam_progress_examId_studentId_key`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
