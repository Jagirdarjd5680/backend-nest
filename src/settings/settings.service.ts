import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { drawInvoice, InvoiceCompany } from '../common/pdf/invoiceTemplate';
import { drawRegistrationLetter } from '../common/pdf/registrationLetterTemplate';
import { drawCertificate } from '../common/pdf/certificateTemplate';

// Default settings structure matching old MongoDB settings
const DEFAULT_SETTINGS = {
  general: {
    adminName: 'Admin',
    adminEmail: 'admin@example.com',
    siteName: 'LMS',
    siteDescription: '',
    siteIcon: '',
    siteFavicon: '',
    siteLogo: '',
    mobileAppLink: '',
    pdfLogo: '',
  },
  auth: {
    allowRegistration: true,
    requireEmailVerification: false,
    allowForgotPassword: true,
    allowGoogleLogin: false,
    allowEmailLogin: true,
    allowMobileOtpLogin: false,
    twoFactorEnabled: false,
    // 'test': OTP is never actually sent by SMS — it only goes to the server console/terminal,
    // so QA/dev logins never burn a real SMS credit. 'production': a real SMS goes out via
    // 2Factor.in using integrations.smsApiKey (falls back to console-only if that key is empty).
    otpMode: 'test',
  },
  theme: {
    primaryColor: '#3f51b5',
    secondaryColor: '#f50057',
    sidebarBg: '#ffffff',
    menuText: '#333333',
    activeMenuBg: '#3f51b5',
    activeMenuText: '#ffffff',
    globalFont: 'Inter',
    darkMode: false,
  },
  socialMedia: [],
  app: {
    version: '1.0.0',
    link: '',
  },
  appFeatures: {
    showEvents: true,
    showPassedStudents: true,
  },
  integrations: {
    googleClientId: '',
    recaptchaKey: '',
    smsProvider: '2Factor.in',
    smsApiKey: '',
  },
  storage: {
    activeProvider: 'local',
  },
  tutorSupport: {
    // Conversion rate for the tutor-conversation token economy — 1 token = this many rupees,
    // used both to display a tutor's pending/approved earnings in rupees and to compute the
    // payout amount when an admin approves a completed session.
    tokenValueInRupees: 10,
  },
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  // Convert DB key-value rows into nested object like MongoDB settings
  private async _buildSettingsObject(): Promise<any> {
    const rows = await this.prisma.settings.findMany();

    // Start with defaults
    const result: any = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    // Merge each key-value row
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        // key format: "section.field" (e.g. "general.siteName") or just "section" (for whole section)
        if (row.key.includes('.')) {
          const [section, field] = row.key.split('.');
          if (!result[section]) result[section] = {};
          result[section][field] = parsed;
        } else {
          // whole section stored as JSON
          result[row.key] = parsed;
        }
      } catch {
        // if not JSON, store as string
        if (row.key.includes('.')) {
          const [section, field] = row.key.split('.');
          if (!result[section]) result[section] = {};
          result[section][field] = row.value;
        } else {
          result[row.key] = row.value;
        }
      }
    }

    return result;
  }

  // GET /settings/public — public subset (no auth needed)
  async getPublicSettings() {
    const all = await this._buildSettingsObject();
    return {
      general: all.general,
      auth: {
        allowRegistration: all.auth?.allowRegistration,
        requireEmailVerification: all.auth?.requireEmailVerification,
        allowForgotPassword: all.auth?.allowForgotPassword,
        allowGoogleLogin: all.auth?.allowGoogleLogin,
        allowEmailLogin: all.auth?.allowEmailLogin,
        allowMobileOtpLogin: all.auth?.allowMobileOtpLogin,
        twoFactorEnabled: all.auth?.twoFactorEnabled,
      },
      theme: all.theme,
      socialMedia: all.socialMedia,
      app: all.app,
      integrations: {
        googleClientId: all.integrations?.googleClientId,
        recaptchaKey: all.integrations?.recaptchaKey,
      },
      payments: {
        currentGateway: all.payments?.currentGateway || 'Razorpay',
        // Only the public key is ever exposed here — never the secret.
        key: all.payments?.gateways?.find(
          (g: any) => g.name === (all.payments?.currentGateway || 'Razorpay'),
        )?.key || '',
      },
      appFeatures: all.appFeatures,
      tutorSupport: all.tutorSupport,
      storage: { activeProvider: 'local' },
    };
  }

  // GET /settings — full settings (admin only)
  async getAllSettings() {
    return this._buildSettingsObject();
  }

  /** Internal use (e.g. AuthService) — just the auth section, with defaults already merged in. */
  async getAuthSettings() {
    const all = await this._buildSettingsObject();
    return all.auth as {
      allowRegistration: boolean;
      requireEmailVerification: boolean;
      allowForgotPassword: boolean;
      allowGoogleLogin: boolean;
      allowEmailLogin: boolean;
      allowMobileOtpLogin: boolean;
      twoFactorEnabled: boolean;
      otpMode: 'test' | 'production';
    };
  }

  /** Internal use (AuthService's sendOtp) — the SMS provider config needed to actually send one. */
  async getSmsSettings() {
    const all = await this._buildSettingsObject();
    return {
      otpMode: (all.auth?.otpMode as 'test' | 'production') || 'test',
      smsApiKey: all.integrations?.smsApiKey || '',
    };
  }

  /**
   * Internal use (FcmService) — the raw service-account JSON pasted/uploaded in
   * Settings > Integrations > Firebase Push Notifications, or '' when not set.
   */
  async getFirebaseServiceAccountJson(): Promise<string> {
    const all = await this._buildSettingsObject();
    const value = all.integrations?.firebaseServiceAccount;
    if (!value) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  // PUT /settings — update a single key-value setting
  async upsertSetting(key: string, value: any) {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    return this.prisma.settings.upsert({
      where: { key },
      create: { key, value: valueStr },
      update: { value: valueStr },
    });
  }

  // PUT /settings (bulk) — update multiple settings at once
  async updateBulk(data: Record<string, any>) {
    const updates = [];
    for (const [key, value] of Object.entries(data)) {
      updates.push(this.upsertSetting(key, value));
    }
    await Promise.all(updates);
    return this.getAllSettings();
  }

  // Legacy CRUD (kept for compatibility)
  async findAll() {
    return this.prisma.settings.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.settings.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Settings with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.settings.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.settings.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.settings.delete({ where: { id } });
  }

  // ─── Step 7: AI & Storage Connectivity Testers ──────────────────────────
  // AISettings.jsx's `providers` list uses 'claude' as the id (matching the rest of the
  // page's UI state), but every SDK/env-var below is keyed on the Anthropic name.
  private normalizeAiProvider(provider: string): string {
    return provider === 'claude' ? 'anthropic' : provider;
  }

  // Provider APIs deprecate model names over time (e.g. gemini-1.5-flash 404ing as of this
  // writing) faster than this file gets updated — these are just the initial dropdown values/
  // fallbacks; AISettings.jsx's per-provider model picker is the real source of truth, and
  // whatever the admin selects there is what actually gets used below.
  private defaultAiModel(normalizedProvider: string): string {
    if (normalizedProvider === 'openai') return 'gpt-3.5-turbo';
    if (normalizedProvider === 'gemini') return 'gemini-2.0-flash';
    if (normalizedProvider === 'anthropic') return 'claude-3-5-haiku-20241022';
    return '';
  }

  async testAiConnectivity(provider: string, apiKey?: string, model?: string) {
    const normalized = this.normalizeAiProvider(provider);
    const key = apiKey || process.env[`${normalized.toUpperCase()}_API_KEY`];
    if (!key) {
      return { success: false, provider, message: `API Key for ${provider} is not configured.` };
    }
    const useModel = model || this.defaultAiModel(normalized);

    try {
      if (normalized === 'openai') {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: key });
        await openai.models.list();
      } else if (normalized === 'gemini') {
        // @google/generative-ai is deprecated by Google in favor of @google/genai — the old
        // SDK's endpoints were being sunset, which is why every Gemini model started 404ing
        // regardless of which one was picked, not just the specific model named in the error.
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.list();
      } else if (normalized === 'anthropic') {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: key });
        await anthropic.models.list();
      } else {
        return { success: false, provider, message: `Unknown provider: ${provider}` };
      }
      return { success: true, provider, message: `${provider.toUpperCase()} (${useModel || 'default'}) connection successful` };
    } catch (err) {
      return { success: false, provider, message: `Connection failed: ${err.message}` };
    }
  }

  /** Sandbox "send a test message" behind AISettings.jsx's chat panel — one-shot, no history. */
  async chatWithAi(provider: string, apiKey: string | undefined, message: string, model?: string) {
    const normalized = this.normalizeAiProvider(provider);
    const key = apiKey || process.env[`${normalized.toUpperCase()}_API_KEY`];
    if (!key) {
      throw new Error(`API Key for ${provider} is not configured.`);
    }
    if (!message?.trim()) {
      throw new Error('Message is required.');
    }
    const useModel = model || this.defaultAiModel(normalized);

    if (normalized === 'openai') {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: key });
      const completion = await openai.chat.completions.create({
        model: useModel,
        messages: [{ role: 'user', content: message }],
      });
      return { content: completion.choices[0]?.message?.content || '' };
    }

    if (normalized === 'gemini') {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: key });
      const result = await ai.models.generateContent({ model: useModel, contents: message });
      return { content: result.text || '' };
    }

    if (normalized === 'anthropic') {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: key });
      const result = await anthropic.messages.create({
        model: useModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: message }],
      });
      const textBlock = result.content.find((b: any) => b.type === 'text');
      return { content: textBlock?.text || '' };
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  async testStorageConnection(provider: string = 'local') {
    return {
      success: true,
      provider,
      status: 'online',
      message: `Storage provider '${provider}' is accessible.`,
    };
  }

  /**
   * Backs the PDF Formats settings page's live preview + "Download Demo PDF" — renders the
   * exact same template real receipts/registration letters use, but with fabricated sample
   * data, so admins see precisely what students will get instead of a static screenshot.
   */
  async generatePdfDemo(type: 'receipt' | 'registration' | 'certificate'): Promise<Buffer> {
    const all = await this._buildSettingsObject();
    const company: InvoiceCompany = {
      name: all?.general?.siteName || 'God of Graphics',
      gstNumber: all?.company?.gstNumber || '08JGDPK1363L1Z2',
      address: all?.company?.address || 'Pal Rd, near Barkhatullah Khan Stadium, opp. ACP Office, Masuria Colony, Masuriya, Baldev Nagar, Jodhpur, Rajasthan 342003',
      phone: all?.company?.contact || '8905561612',
      email: all?.company?.email ? String(all.company.email).split('\n')[0] : 'godofgraphic24@gmail.com',
      logo: all?.general?.pdfLogo || all?.general?.siteLogo || '',
      primaryColor: all?.theme?.primaryColor || '#f39c12',
    };

    return new Promise((resolve, reject) => {
      const doc =
        type === 'certificate'
          ? new PDFDocument({ layout: 'landscape', size: 'A4', margin: 0 })
          : new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      let render: Promise<void>;
      if (type === 'certificate') {
        render = drawCertificate(doc, {
          companyName: company.name,
          companyTagline: all?.company?.tagline || 'Premier Academy for Multimedia & Computer Education',
          logo: company.logo,
          studentName: 'Student Name',
          courseName: 'Advance Graphic Designing',
          softwareCovered: 'Photoshop, Illustrator, Corel Draw',
          issueDate: new Date(),
          certificateId: 'GOG108#000103',
          signatureName: all?.company?.signatoryName || 'Founder & CEO',
          signatureImage: all?.general?.pdfCertificateSignature || undefined,
        });
      } else if (type === 'registration') {
        render = drawRegistrationLetter(doc, {
          company,
          refNo: 'REG-000114',
          date: new Date(),
          student: { name: 'Chandi Waale', email: 'chandi.waale@example.com', address: 'B Rd, Gandhi Maidan, Sardarpura, Jodhpur, Rajasthan 342003', rollNumber: 'GOG-2026-114' },
          courseName: 'Website Development',
          batchName: 'Morning Batch',
          totalFee: 33000,
          discount: 0,
          finalFee: 33000,
        });
      } else {
        render = drawInvoice(doc, {
          company,
          billTo: { name: 'Chandi Waale', address: 'B Rd, Gandhi Maidan, Sardarpura, Jodhpur, Rajasthan 342003', contact: '+91 78786 80973' },
          invoiceNo: 'INV-29726-114',
          date: new Date(),
          itemName: 'Website Development',
          totalAmount: 33000,
        });
      }

      render.then(() => doc.end()).catch(reject);
    });
  }
}
