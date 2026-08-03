export type ProgressBucket = { completed: number; total: number };

export type ProgressBreakdown = {
  lessons: ProgressBucket;
  exams: ProgressBucket;
  assignments: ProgressBucket;
};

/**
 * Single source of truth for "how far along is this student in this
 * course". Every gradable unit (lecture, exam, assignment) counts as one
 * equal-weight item toward 100% — a course with 10 lectures, 2 exams and 3
 * assignments has 15 units total, so completing 1 lecture is ~7%, not the
 * naive (and wrong) 10% you'd get counting lectures alone.
 */
export function calculateProgressPercent(breakdown: ProgressBreakdown): number {
  const totalUnits = breakdown.lessons.total + breakdown.exams.total + breakdown.assignments.total;
  if (totalUnits === 0) return 0;

  const completedUnits = breakdown.lessons.completed + breakdown.exams.completed + breakdown.assignments.completed;
  return Math.min(100, Math.round((completedUnits / totalUnits) * 100));
}
