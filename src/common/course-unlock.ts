import { PrismaService } from '../prisma/prisma.service';
import { lectureId } from '../course-progress/course-lectures';

/**
 * Course exams / assignments open by the student's progress, not by calendar date.
 *
 *   immediate     - as soon as the course is bought (default)
 *   after_days    - `unlockAfterDays` days after the student's enrollment
 *   after_modules - once `unlockAfterModules` modules are fully completed
 *   after_module  - once the module at `unlockModuleIndex` (0-based) is fully completed
 */
export type UnlockMode = 'immediate' | 'after_days' | 'after_modules' | 'after_module';

export const UNLOCK_MODES: UnlockMode[] = ['immediate', 'after_days', 'after_modules', 'after_module'];

export interface UnlockRule {
  unlockMode: string;
  unlockAfterDays?: number | null;
  unlockAfterModules?: number | null;
  unlockModuleIndex?: number | null;
}

export type ModuleStatus = { index: number; title: string; completed: boolean };

/** Per-request memo so a list of many exams/assignments reads each course's progress once. */
export class UnlockContext {
  readonly modules = new Map<number, ModuleStatus[]>();
  readonly enrolledAt = new Map<number, Date | null>();
}

/** A module is complete when every lecture in it is done (assignment/exam lessons don't count). */
export async function moduleStatus(prisma: PrismaService, studentId: number, courseId: number): Promise<ModuleStatus[]> {
  const [course, progress] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { modules: true } }),
    prisma.courseProgress.findUnique({ where: { studentId_courseId: { studentId, courseId } } }),
  ]);
  const modules = Array.isArray(course?.modules) ? (course!.modules as any[]) : [];
  let done = new Set<string>();
  try {
    done = new Set<string>(JSON.parse(progress?.completedLessons || '[]').map(String));
  } catch {
    done = new Set();
  }
  return modules.map((m, index) => {
    const ids: string[] = (Array.isArray(m?.videos) ? m.videos : [])
      .map((v: any, vi: number) => ({ v, id: lectureId(courseId, index, vi, v) }))
      .filter((x: any) => !['assignment', 'exam'].includes(String(x.v?.type ?? 'video')))
      .map((x: any) => x.id);
    // A module with nothing to watch counts as done.
    return { index, title: String(m?.title ?? `Module ${index + 1}`), completed: ids.every((id) => done.has(id)) };
  });
}

/** Whether the item is still closed for this student, and a human reason the app can show. */
export async function evaluateUnlock(
  prisma: PrismaService,
  rule: UnlockRule,
  studentId: number,
  courseId: number | null,
  ctx: UnlockContext,
): Promise<{ locked: boolean; reason: string | null }> {
  const open = { locked: false, reason: null };
  if (!courseId || !UNLOCK_MODES.includes(rule.unlockMode as UnlockMode) || rule.unlockMode === 'immediate') return open;

  if (rule.unlockMode === 'after_days') {
    const since = await enrolledAt(prisma, studentId, courseId, ctx);
    const days = Math.max(rule.unlockAfterDays ?? 0, 0);
    if (!since || days === 0) return open;
    const opensAt = new Date(since.getTime() + days * 24 * 60 * 60 * 1000);
    if (Date.now() >= opensAt.getTime()) return open;
    const left = Math.ceil((opensAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return { locked: true, reason: `Unlocks ${days} day${days === 1 ? '' : 's'} after you join the course - ${left} day${left === 1 ? '' : 's'} to go` };
  }

  if (!ctx.modules.has(courseId)) ctx.modules.set(courseId, await moduleStatus(prisma, studentId, courseId));
  const mods = ctx.modules.get(courseId)!;

  if (rule.unlockMode === 'after_modules') {
    const need = Math.min(Math.max(rule.unlockAfterModules ?? 1, 1), Math.max(mods.length, 1));
    const have = mods.filter((m) => m.completed).length;
    return have >= need
      ? open
      : { locked: true, reason: `Complete ${need} module${need === 1 ? '' : 's'} to unlock this (${have}/${need} done)` };
  }

  // after_module
  const target = mods[rule.unlockModuleIndex ?? 0];
  if (!target) return open;
  return target.completed ? open : { locked: true, reason: `Complete the module "${target.title}" to unlock this` };
}

/** Normalises the unlock fields of a create/update body (only keys that were actually sent). */
export function unlockFieldsFromBody(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data || !('unlockMode' in data)) return out;
  const int = (v: any) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
  const mode: UnlockMode = UNLOCK_MODES.includes(data.unlockMode) ? data.unlockMode : 'immediate';
  out.unlockMode = mode;
  out.unlockAfterDays = mode === 'after_days' ? Math.max(int(data.unlockAfterDays) ?? 1, 1) : null;
  out.unlockAfterModules = mode === 'after_modules' ? Math.max(int(data.unlockAfterModules) ?? 1, 1) : null;
  out.unlockModuleIndex = mode === 'after_module' ? Math.max(int(data.unlockModuleIndex) ?? 0, 0) : null;
  return out;
}

/** When the student joined the course (memoised per request). */
export async function enrolledAt(prisma: PrismaService, studentId: number, courseId: number, ctx: UnlockContext): Promise<Date | null> {
  if (!ctx.enrolledAt.has(courseId)) {
    const enr = await prisma.enrollment.findFirst({ where: { userId: studentId, courseId }, select: { createdAt: true } });
    ctx.enrolledAt.set(courseId, enr?.createdAt ?? null);
  }
  return ctx.enrolledAt.get(courseId) ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment an already-unlocked item opened for this student - what a "N days after it opens"
 * deadline counts from:
 *   immediate     -> the day they joined the course
 *   after_days    -> joining day + N days
 *   after_modules / after_module -> the first moment the progress rule was seen satisfied
 *                    (stored in `remember`, so the clock does not restart on every request)
 */
export async function openedAt(
  prisma: PrismaService,
  rule: UnlockRule,
  studentId: number,
  courseId: number,
  ctx: UnlockContext,
  remember: () => Promise<Date>,
): Promise<Date | null> {
  const joined = await enrolledAt(prisma, studentId, courseId, ctx);
  if (rule.unlockMode === 'after_modules' || rule.unlockMode === 'after_module') return remember();
  if (!joined) return null;
  if (rule.unlockMode === 'after_days') return new Date(joined.getTime() + Math.max(rule.unlockAfterDays ?? 0, 0) * DAY_MS);
  return joined;
}

export { DAY_MS };
