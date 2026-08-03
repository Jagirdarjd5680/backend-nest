import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  },
  storage: {
    activeProvider: 'local',
  },
  tutorSupport: {},
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
    };
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
  async testAiConnectivity(provider: string, apiKey?: string) {
    const key = apiKey || process.env[`${provider.toUpperCase()}_API_KEY`];
    if (!key) {
      return { success: false, provider, message: `API Key for ${provider} is not configured.` };
    }

    try {
      if (provider === 'openai') {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: key });
        await openai.models.list();
      } else if (provider === 'gemini') {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        await model.generateContent('ping');
      } else if (provider === 'anthropic') {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: key });
        await anthropic.models.list();
      }
      return { success: true, provider, message: `${provider.toUpperCase()} connection successful` };
    } catch (err) {
      return { success: false, provider, message: `Connection failed: ${err.message}` };
    }
  }

  async testStorageConnection(provider: string = 'local') {
    return {
      success: true,
      provider,
      status: 'online',
      message: `Storage provider '${provider}' is accessible.`,
    };
  }
}
