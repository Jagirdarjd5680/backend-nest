-- Stores the face_recognition encoding (128 floats) returned by python_service's
-- /get-descriptor, so /attendance/verify can actually match a check-in photo against a
-- real student instead of blindly marking whoever happens to be first in the batch.
ALTER TABLE `users` ADD COLUMN `faceDescriptor` JSON NULL;
