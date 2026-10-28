import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request, Res } from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
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

  @Get('preview/:studentId/:courseId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async previewCertificate(
    @Param('studentId') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.service.issueCertificate({
      studentId: parseInt(studentId, 10),
      courseId: parseInt(courseId, 10),
      force: true,
    });
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
