/**
 * Course lectures live in `Course.modules` JSON, which has no ids of its own (the Lesson
 * table is wiped and recreated on every course edit, so its ids aren't stable either).
 * Every lecture gets `<courseId>-module-<m>-lesson-<l>` — the format existing
 * CourseProgress.completedLessons rows already use — unless the JSON carries its own `_id`.
 */
export type CourseLecture = { id: string; type: string; duration: number };

const NON_LECTURE = ['assignment', 'exam'];

export function lectureId(courseId: number, moduleIndex: number, lessonIndex: number, video: any): string {
  const own = video?._id ?? video?.id;
  return own != null && own !== '' ? String(own) : `${courseId}-module-${moduleIndex}-lesson-${lessonIndex}`;
}

/** Returns a copy of `modules` with `_id` set on every lecture. */
export function withLectureIds(courseId: number, modules: unknown): unknown {
  if (!Array.isArray(modules)) return modules;
  return modules.map((m: any, mi: number) => {
    if (!m || !Array.isArray(m.videos)) return m;
    return { ...m, videos: m.videos.map((v: any, vi: number) => (v && typeof v === 'object' ? { ...v, _id: lectureId(courseId, mi, vi, v) } : v)) };
  });
}

/** Strips lecture `_id`s (for a duplicated course, whose ids must not collide with the original's). */
export function withoutLectureIds(modules: unknown): unknown {
  if (!Array.isArray(modules)) return modules;
  return modules.map((m: any) => {
    if (!m || !Array.isArray(m.videos)) return m;
    return { ...m, videos: m.videos.map((v: any) => {
      if (!v || typeof v !== 'object') return v;
      const { _id, id, ...rest } = v;
      return rest;
    }) };
  });
}

/** Flat list of a course's lectures (assignments/exams excluded) with their durations in seconds. */
export function courseLectures(courseId: number, modules: unknown): CourseLecture[] {
  if (!Array.isArray(modules)) return [];
  const out: CourseLecture[] = [];
  modules.forEach((m: any, mi: number) => {
    (Array.isArray(m?.videos) ? m.videos : []).forEach((v: any, vi: number) => {
      const type = String(v?.type ?? 'video');
      if (NON_LECTURE.includes(type)) return;
      const duration = Number(v?.duration) || 0;
      out.push({ id: lectureId(courseId, mi, vi, v), type, duration: Math.max(0, Math.round(duration)) });
    });
  });
  return out;
}
