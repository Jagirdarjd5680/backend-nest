-- Live classes become required-course-scoped, with a status field and a real FK relation.
-- Table is empty in all known environments, so courseId can go straight to NOT NULL.
ALTER TABLE `live_classes` ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled';
ALTER TABLE `live_classes` MODIFY `courseId` INT NOT NULL;

CREATE INDEX `live_classes_courseId_idx` ON `live_classes`(`courseId`);

ALTER TABLE `live_classes` ADD CONSTRAINT `live_classes_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
