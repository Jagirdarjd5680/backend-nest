import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SIGNED_SECURE_MEDIA_URL = /^\/api\/secure-media\/file\?path=([^&]+)(&.*)?$/;

@Injectable()
export class FreeMaterialsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Admin's media/gallery picker returns URLs already re-signed by MediaUrlSigningInterceptor
   * for THAT request (15-minute token baked into the query string). Saving that string verbatim
   * meant the link died ~15 minutes after the admin picked it, forever — MediaUrlSigningInterceptor
   * only re-signs strings matching the raw `/uploads/...` shape, so a stored, already-signed
   * `/api/secure-media/file?...` URL never gets a fresh token again. Strip it back down to the
   * raw relative path here so every future fetch (admin or app) gets re-signed on the way out.
   */
  private normalizeUrl(data: any) {
    if (typeof data?.url === 'string') {
      const match = data.url.match(SIGNED_SECURE_MEDIA_URL);
      if (match) {
        data = { ...data, url: `/uploads/${decodeURIComponent(match[1])}` };
      }
    }
    return data;
  }

  async findAll() {
    return this.prisma.freeMaterial.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.freeMaterial.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`FreeMaterials with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.freeMaterial.create({ data: this.normalizeUrl(data) });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.freeMaterial.update({ where: { id }, data: this.normalizeUrl(data) });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.freeMaterial.delete({ where: { id } });
  }
}
