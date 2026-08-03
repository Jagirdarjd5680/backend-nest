-- Prisma Migration: which platform(s) a course may be accessed from ("web" | "app" | "both")
ALTER TABLE `courses` ADD COLUMN `platformAccess` VARCHAR(191) NOT NULL DEFAULT 'both';
