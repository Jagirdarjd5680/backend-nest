-- Prisma Migration: adds granular per-module (view/add/edit/delete) permissions for teacher accounts
ALTER TABLE `users` ADD COLUMN `modulePermissions` JSON NULL;
