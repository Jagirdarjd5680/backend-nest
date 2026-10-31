import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';

const prisma = new PrismaClient();

export const sendEmail = async (options: {
  email: string;
  subject: string;
  message?: string;
  html?: string;
  attachments?: any[];
}) => {
  // Phone/OTP accounts have no email on file.
  if (!options.email) return false;

  try {
    const settingsList = await prisma.settings.findMany();
    const smtpHost = settingsList.find(s => s.key === 'smtp_host')?.value;
    const smtpPort = settingsList.find(s => s.key === 'smtp_port')?.value;
    const smtpUser = settingsList.find(s => s.key === 'smtp_user')?.value;
    const smtpPass = settingsList.find(s => s.key === 'smtp_pass')?.value;
    const smtpFrom = settingsList.find(s => s.key === 'smtp_from')?.value;
    const siteName = settingsList.find(s => s.key === 'site_name')?.value || 'LMS';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log('📧 SMTP Config missing keys in DB settings');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '587'),
      secure: smtpPort === '465',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const message = {
      from: `"${siteName}" <${smtpFrom || smtpUser}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html,
      attachments: options.attachments || [],
    };

    const info = await transporter.sendMail(message);
    return info;
  } catch (error) {
    console.error('📧 Error sending email:', error.message);
    return false;
  }
};
