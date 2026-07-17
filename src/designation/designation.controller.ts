import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { DesignationService } from './designation.service.js';
import { CreateDesignationDto } from './dto/create-designation.dto.js';
import { UpdateDesignationDto } from './dto/update-designation.dto.js';
import { ResponseMessage } from '../common/index.js';
import { FindDesignationDto } from './dto/find-designation.dto.js';

@Controller('designations')
export class DesignationController {
  constructor(private readonly designationService: DesignationService) {}

  @Post()
  @ResponseMessage('Designation created successfully!')
  create(@Body() createDesignationDto: CreateDesignationDto) {
    return this.designationService.create(createDesignationDto);
  }

  @Get()
  @ResponseMessage('Designations fetched successfully!')
  findAll(@Query() query: FindDesignationDto) {
    return this.designationService.findAll(query);
  }

  @Get(':id')
  @ResponseMessage('Designation fetchd successfully')
  findOne(@Param('id') id: string) {
    return this.designationService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Designation updated successfully!')
  update(
    @Param('id') id: string,
    @Body() updateDesignationDto: UpdateDesignationDto,
  ) {
    return this.designationService.update(id, updateDesignationDto);
  }

  @Delete(':id')
  @ResponseMessage("Designation deleted successfully!")
  remove(@Param('id') id: string) {
    return this.designationService.remove(id);
  }
}
