-- What the admin typed in the certificate's Edit form; null = use the live value
-- (student's current name, course title, reading time, exam-based grade).
ALTER TABLE "certificates" ADD COLUMN "studentName" TEXT;
ALTER TABLE "certificates" ADD COLUMN "courseName" TEXT;
ALTER TABLE "certificates" ADD COLUMN "duration" TEXT;
ALTER TABLE "certificates" ADD COLUMN "grade" TEXT;
ALTER TABLE "certificates" ADD COLUMN "specialization" TEXT;
