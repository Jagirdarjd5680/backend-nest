import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'teacher')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  async search(@Query('q') query: string, @Query('type') type?: string) {
    return this.searchService.searchAll(query, type);
  }
}
