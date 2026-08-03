import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class BulkDeleteDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  fileNames: string[];
}
