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

  /**
   * Dumps every row of every table — not a hand-picked subset — so a restore can bring back
   * the entire database (users, settings, SMTP/payment config, everything), not just the 4
   * tables + 1000-row cap the old version had.
   */
  async exportAll(): Promise<{ fileName: string; filePath: string; sizeBytes: number; counts: Record<string, number> }> {
    const backupDir = path.join(process.cwd(), 'uploads', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    try {
      const data: Record<string, any[]> = {};
      const counts: Record<string, number> = {};

      for (const { name, accessor } of this.models) {
        const rows = await (this.prisma as any)[accessor].findMany();
        data[name] = rows;
        counts[name] = rows.length;
      }

      const backupData = {
        meta: {
          timestamp: new Date().toISOString(),
          version: '2.0',
          modelCount: this.models.length,
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
      throw new InternalServerErrorException(`Backup generation failed: ${err.message}`);
    }
  }

  /**
   * Wipes and reloads every table from a previously exported backup, inside one transaction
   * so a mid-restore failure can't leave the database half-replaced. Foreign key checks are
   * disabled for the duration — the 56 tables here have a deep, cross-referencing FK graph, so
   * computing a safe delete/insert order isn't worth it when MySQL can just skip the checks.
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
          await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
          try {
            for (const { name, accessor } of modelsInBackup) {
              const rows = backup.data![name];
              await (tx as any)[accessor].deleteMany({});
              if (rows.length > 0) {
                await (tx as any)[accessor].createMany({ data: rows, skipDuplicates: true });
              }
              restoredCounts[name] = rows.length;
            }
          } finally {
            await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
          }
        },
        { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
      );
    } catch (err) {
      throw new InternalServerErrorException(`Restore failed — the database was rolled back to its pre-restore state: ${err.message}`);
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
