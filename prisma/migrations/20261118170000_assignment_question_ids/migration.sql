-- Quiz assignments: the question-bank ids chosen for the assignment.
ALTER TABLE "assignments" ADD COLUMN "questionIds" JSONB;
