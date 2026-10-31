import { PrismaService } from '../prisma/prisma.service';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Web admin saves SMTP as one JSON row (settings.key = 'smtp'); fall back to SMTP_* env vars
 * so servers configured the old way keep working. Returns null when neither is complete.
 */
export async function getSmtpConfig(prisma: PrismaService): Promise<SmtpConfig | null> {
  try {
    const row = await prisma.settings.findUnique({ where: { key: 'smtp' } });
    const smtp = row?.value ? JSON.parse(row.value) : null;
    if (smtp?.host && smtp?.user && smtp?.pass) {
      return {
        host: smtp.host,
        port: parseInt(smtp.port || '587', 10),
        user: smtp.user,
        pass: smtp.pass,
        from: smtp.from || smtp.user,
      };
    }
  } catch (err) {
    console.error('[SMTP] Could not read smtp setting:', err.message);
  }

  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    return { host: SMTP_HOST, port: parseInt(SMTP_PORT || '587', 10), user: SMTP_USER, pass: SMTP_PASS, from: SMTP_USER };
  }
  return null;
}
