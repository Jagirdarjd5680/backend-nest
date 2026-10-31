-- Phone/OTP signups have no email — stop storing a fake `<phone>@otp.local` address.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
UPDATE "users" SET "email" = NULL WHERE "email" LIKE '%@otp.local';
