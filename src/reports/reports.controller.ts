import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private service: ReportsService) {}

  // GET /api/reports/dashboard?startDate=...&endDate=...
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  @Get('dashboard')
  async getDashboard(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Request() req: any,
  ) {
    return this.service.getDashboard(startDate, endDate, req.user.role, req.user.id);
  }

  // GET /api/reports/student-dashboard
  @Get('student-dashboard')
  async getStudentDashboard(@Request() req: any) {
    return this.service.getStudentDashboard(req.user.id);
  }

  // GET /api/reports/student-performance
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  @Get('student-performance')
  async getStudentPerformance() {
    return this.service.getStudentPerformance();
  }
}
