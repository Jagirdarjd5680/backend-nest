-- Resume builder stores its whole document as JSON (web sent it and the insert 500'd).
ALTER TABLE "resumes" ALTER COLUMN "filePath" SET DEFAULT '';
ALTER TABLE "resumes" ADD COLUMN "data" JSONB;
ALTER TABLE "resumes" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
