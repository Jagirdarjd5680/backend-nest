import { Module } from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { PdfService } from './pdf.service';

@Module({
  providers: [CertificatesService, PdfService],
  controllers: [CertificatesController],
  exports: [CertificatesService, PdfService],
})
export class CertificatesModule {}
