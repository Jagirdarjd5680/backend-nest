import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request, Res } from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IssueCertificateDto, CertificateFieldsDto } from './dto/issue-certificate.dto';
import { Response } from 'express';

@Controller('certificates')
@UseGuards(JwtAuthGuard)
export class CertificatesController {
  constructor(private service: CertificatesService) {}

  @Post('issue')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async issueCertificate(@Body() dto: IssueCertificateDto) {
    return this.service.issueCertificate(dto);
  }

  @Get('my-certificates')
  async getMyCertificates(@Request() req: any) {
    return this.service.getMyCertificates(req.user.id);
  }

  @Get('course/:courseId')
  async getCourseCertificate(@Request() req: any, @Param('courseId') courseId: string) {
    return this.service.getCourseCertificate(req.user.id, parseInt(courseId, 10));
  }

  /** Defaults + saved values for the admin's certificate Edit form. */
  @Get('form/:studentId/:courseId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async certificateForm(@Param('studentId') studentId: string, @Param('courseId') courseId: string) {
    return this.service.getCertificateForm(parseInt(studentId, 10), parseInt(courseId, 10));
  }

  /** Preview with the Edit form's (unsaved) values. */
  @Post('preview/:studentId/:courseId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async previewWithFields(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
    @Body() fields: CertificateFieldsDto,
    @Res() res: Response,
  ) {
    const pdf = await this.service.previewCertificate(parseInt(studentId, 10), parseInt(courseId, 10), fields);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificate-preview.pdf"');
    res.send(pdf);
  }

  @Get('preview/:studentId/:courseId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async previewCertificate(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
    @Res() res: Response,
  ) {
    // Used to call issueCertificate(force) — "preview" silently issued a real certificate.
    const pdf = await this.service.previewCertificate(parseInt(studentId, 10), parseInt(courseId, 10));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificate-preview.pdf"');
    res.send(pdf);
  }

  @Get(':id/download')
  async downloadCertificate(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { filePath, fileName } = await this.service.getCertificateFile(
      parseInt(id, 10),
      req.user.id,
      req.user.role,
    );
    return res.download(filePath, fileName);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
