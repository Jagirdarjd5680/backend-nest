-- Admin's approve/reject note was being sent by the frontend but silently dropped —
-- the backend route only ever read `status` from the body.
ALTER TABLE `leave_requests` ADD COLUMN `adminMessage` TEXT NULL;
