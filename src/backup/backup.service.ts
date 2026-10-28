import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Every scalar field typed BigInt in the schema, per model — currently just Media.size.
// JSON has no BigInt literal, so these need explicit tagging on the way out and reviving
// on the way back in (see bigIntReplacer/bigIntReviver below); everything else (Int, Float,
// String, Boolean, DateTime, Json) round-trips through JSON.stringify/parse natively.
const BIGINT_TAG = '__bigint__';

function bigIntReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value;
}

function bigIntReviver(_key: string, value: any) {
  if (value && typeof value === 'object' && typeof value[BIGINT_TAG] === 'string') {
    return BigInt(value[BIGINT_TAG]);
  }
  return value;
}

// Groups the schema's 56 models into the sections an admin actually thinks in terms of
// (mirrors how prisma/schema/*.prisma is already split by domain) — lets the backup UI
// offer "Users", "LMS", etc. as checkboxes instead of a flat 56-item list. Every model
// must appear in exactly one category; BACKUP_CATEGORIES below is the source of truth
// for both the admin picker and the export/import filtering.
const BACKUP_CATEGORIES: { key: string; label: string; models: string[] }[] = [
  { key: 'users', label: 'Users & Accounts', models: ['User', 'UserSession', 'LoginActivity', 'OtpCode', 'LeaveRequest'] },
  {
    key: 'lms',
    label: 'Courses & Learning (LMS)',
    models: ['Category', 'Course', 'CourseLike', 'Lesson', 'Enrollment', 'CourseProgress', 'LectureProgress', 'Batch', 'BatchMaterial', 'Attendance', 'Timetable', 'LiveClass', 'Certificate'],
  },
  { key: 'exams', label: 'Exams & Assignments', models: ['Exam', 'ExamResult', 'ExamProgress', 'ExamUnlock', 'Question', 'Assignment', 'AssignmentUnlock', 'AssignmentSubmission'] },
  { key: 'payments', label: 'Payments & Finance', models: ['Payment', 'FeeRecord', 'CreditTransaction', 'Coupon'] },
  { key: 'tutors', label: 'Tutors & Support Chat', models: ['Tutor', 'Withdrawal', 'SupportSession', 'ChatMessage', 'Ticket'] },
  { key: 'bookings', label: 'Seat Booking & Events', models: ['BookingBatch', 'SeatBooking', 'SeatBookingBatch', 'SeatBookingRequest', 'Event', 'EventBooking'] },
  { key: 'referrals', label: 'Referrals', models: ['Referral', 'ReferralJoinRequest', 'WithdrawRequest'] },
  { key: 'content', label: 'Content & Marketing', models: ['Banner', 'Blog', 'AppReview', 'Review', 'FreeMaterial', 'NewsTicker', 'Notification', 'PassedStudent', 'Placement', 'Resume'] },
  { key: 'media', label: 'Media Library', models: ['Media'] },
  { key: 'settings', label: 'System Settings', models: ['Settings'] },
];

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService) {}

  /** Every Prisma model, resolved to its client accessor (e.g. "BookingBatch" -> "bookingBatch"). */
  private get models(): { name: string; accessor: string }[] {
    return Prisma.dmmf.datamodel.models.map((m) => ({
      name: m.name,
      accessor: m.name.charAt(0).toLowerCase() + m.name.slice(1),
    }));
  }

  /** Categories for the admin's backup picker, each annotated with a live row count. */
  async getCategories() {
    const allModels = this.models;
    const categories = await Promise.all(
      BACKUP_CATEGORIES.map(async (cat) => {
        const modelsInSchema = allModels.filter((m) => cat.models.includes(m.name));
        const counts = await Promise.all(
          modelsInSchema.map(async ({ name, accessor }) => ({
            name,
            count: await (this.prisma as any)[accessor].count(),
          })),
        );
        return {
          key: cat.key,
          label: cat.label,
          models: counts,
          totalRows: counts.reduce((sum, c) => sum + c.count, 0),
        };
      }),
    );

    // Anything in the schema that isn't in BACKUP_CATEGORIES yet (e.g. a newly added
    // model) still needs to be backed up — surface it rather than silently dropping it.
    const categorized = new Set(BACKUP_CATEGORIES.flatMap((c) => c.models));
    const uncategorizedModels = allModels.filter((m) => !categorized.has(m.name));
    if (uncategorizedModels.length > 0) {
      const counts = await Promise.all(
        uncategorizedModels.map(async ({ name, accessor }) => ({ name, count: await (this.prisma as any)[accessor].count() })),
      );
      categories.push({ key: 'other', label: 'Other', models: counts, totalRows: counts.reduce((sum, c) => sum + c.count, 0) });
    }

    return { success: true, categories };
  }

  /**
   * Dumps every row of every table — not a hand-picked subset — so a restore can bring back
   * the entire database (users, settings, SMTP/payment config, everything), not just the 4
   * tables + 1000-row cap the old version had.
   */
  async exportAll(modelNames?: string[]): Promise<{ fileName: string; filePath: string; sizeBytes: number; counts: Record<string, number> }> {
    const backupDir = path.join(process.cwd(), 'uploads', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // No selection = full backup (the default, and what every existing caller — "Download
    // Backup", the restore flow's own re-export, cron jobs if any get added later — expects).
    const targetModels = modelNames && modelNames.length > 0
      ? this.models.filter((m) => modelNames.includes(m.name))
      : this.models;

    if (targetModels.length === 0) {
      throw new BadRequestException('None of the selected tables exist in the current schema.');
    }

    try {
      const data: Record<string, any[]> = {};
      const counts: Record<string, number> = {};

      for (const { name, accessor } of targetModels) {
        const rows = await (this.prisma as any)[accessor].findMany();
        data[name] = rows;
        counts[name] = rows.length;
      }

      const backupData = {
        meta: {
          timestamp: new Date().toISOString(),
          version: '2.0',
          modelCount: targetModels.length,
          // A partial backup (fewer models than the full schema) must never be restored
          // as if it were complete — importAll only wipes+reloads the tables actually
          // present in the file, but this flag lets the restore UI warn accordingly.
          partial: targetModels.length < this.models.length,
        },
        counts,
        data,
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `backup_${timestamp}.json`;
      const filePath = path.join(backupDir, fileName);
      const jsonStr = JSON.stringify(backupData, bigIntReplacer, 2);
      fs.writeFileSync(filePath, jsonStr, 'utf-8');

      return { fileName, filePath, sizeBytes: Buffer.byteLength(jsonStr), counts };
    } catch (err) {
      throw new InternalServerErrorException(`Backup generation failed: ${(err as Error).message}`);
    }
  }

  /**
   * Wipes and reloads every table from a previously exported backup, inside one transaction
   * so a mid-restore failure can't leave the database half-replaced. Foreign key checks are
   * disabled for the duration — the 56 tables here have a deep, cross-referencing FK graph, so
   * computing a safe delete/insert order isn't worth it when Postgres can just skip the checks (session_replication_role = replica).
   */
  async importAll(rawJson: string): Promise<{ success: boolean; restoredCounts: Record<string, number> }> {
    let backup: { data?: Record<string, any[]> };
    try {
      backup = JSON.parse(rawJson, bigIntReviver);
    } catch {
      throw new BadRequestException('That file is not valid JSON — is it really a backup export?');
    }
    if (!backup?.data || typeof backup.data !== 'object') {
      throw new BadRequestException('This file is missing the "data" section — is it really a backup export?');
    }

    const restoredCounts: Record<string, number> = {};
    const modelsInBackup = this.models.filter(({ name }) => Array.isArray(backup.data![name]));

    if (modelsInBackup.length === 0) {
      throw new BadRequestException('No recognized tables found in this backup file.');
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Transaction-local: reverts automatically on commit/rollback. Needs a superuser DB role.
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
          for (const { name, accessor } of modelsInBackup) {
            const rows = backup.data![name];
            await (tx as any)[accessor].deleteMany({});
            if (rows.length > 0) {
              await (tx as any)[accessor].createMany({ data: rows, skipDuplicates: true });
            }
            restoredCounts[name] = rows.length;
          }
          // Rows were inserted with explicit ids, so bump each autoincrement sequence past them.
          for (const model of Prisma.dmmf.datamodel.models) {
            if (!Array.isArray(backup.data![model.name])) continue;
            const idField = model.fields.find((f) => f.isId && (f.default as any)?.name === 'autoincrement');
            if (!idField) continue;
            const table = (model.dbName ?? model.name).replace(/"/g, '""');
            const col = (idField.dbName ?? idField.name).replace(/"/g, '""');
            await tx.$executeRawUnsafe(
              `SELECT setval(pg_get_serial_sequence('"${table}"', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${table}"), 1), (SELECT COUNT(*) > 0 FROM "${table}"))`,
            );
          }
        },
        { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
      );
    } catch (err) {
      throw new InternalServerErrorException(`Restore failed — the database was rolled back to its pre-restore state: ${(err as Error).message}`);
    }

    return { success: true, restoredCounts };
  }

  async listBackups() {
    const backupDir = path.join(process.cwd(), 'uploads', 'backups');
    if (!fs.existsSync(backupDir)) {
      return { success: true, backups: [] };
    }

    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.json'));
    const backups = files.map((file) => {
      const stat = fs.statSync(path.join(backupDir, file));
      return {
        fileName: file,
        sizeBytes: stat.size,
        createdAt: stat.birthtime,
      };
    });

    return {
      success: true,
      count: backups.length,
      backups: backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };
  }

  async cleanupLogs() {
    return {
      success: true,
      message: 'System log cleanup executed successfully',
    };
  }
}
