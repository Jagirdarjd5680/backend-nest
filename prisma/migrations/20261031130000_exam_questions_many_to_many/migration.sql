-- A bank question can belong to many exams. `questions.examId` allowed only one, so
-- assigning a question to exam B silently removed it from exam A.
CREATE TABLE "exam_questions" (
    "examId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("examId","questionId")
);

CREATE INDEX "exam_questions_questionId_idx" ON "exam_questions"("questionId");

ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the existing single-exam assignments.
INSERT INTO "exam_questions" ("examId", "questionId")
SELECT q."examId", q."id" FROM "questions" q
JOIN "exams" e ON e."id" = q."examId"
WHERE q."examId" IS NOT NULL;

-- `examId` stays as a plain legacy column; it is no longer a relation.
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_examId_fkey";
