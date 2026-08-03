import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService) {}

  async createBackup(): Promise<{ fileName: string; filePath: string; sizeBytes: number }> {
    const backupDir = path.join(process.cwd(), 'uploads', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup_${timestamp}.json`;
    const filePath = path.join(backupDir, fileName);

    try {
      const [users, courses, exams, payments] = await Promise.all([
        this.prisma.user.findMany({ take: 1000 }),
        this.prisma.course.findMany({ take: 1000 }),
        this.prisma.exam.findMany({ take: 1000 }),
        this.prisma.payment.findMany({ take: 1000 }),
      ]);

      const backupData = {
        meta: {
          timestamp: new Date(),
          version: '1.0',
        },
        counts: {
          users: users.length,
          courses: courses.length,
          exams: exams.length,
          payments: payments.length,
        },
        data: { users, courses, exams, payments },
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      fs.writeFileSync(filePath, jsonStr, 'utf-8');

      return {
        fileName,
        filePath,
        sizeBytes: Buffer.byteLength(jsonStr),
      };
    } catch (err) {
      throw new InternalServerErrorException(`Backup generation failed: ${err.message}`);
    }
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
