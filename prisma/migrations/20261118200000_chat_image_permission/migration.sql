-- Chat: image uploads are off by default; the admin allows them per user.
ALTER TABLE "users" ADD COLUMN "canSendChatImages" BOOLEAN NOT NULL DEFAULT false;
