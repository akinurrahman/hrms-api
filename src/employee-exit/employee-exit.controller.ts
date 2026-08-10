import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { EmployeeExitService } from './employee-exit.service.js';
import { CreateEmployeeExitDto } from './dto/create-employee-exit.dto.js';
import { UpdateEmployeeExitDto } from './dto/update-employee-exit.dto.js';
import { ExitDocumentDto } from './dto/exit-document.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { ResponseMessage } from '../common/index.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Roles(Role.SITE_ADMIN)
@Controller('employees/:employeeId/exit')
export class EmployeeExitController {
  constructor(private readonly employeeExitService: EmployeeExitService) {}

  @ResponseMessage('Employee exited successfully!')
  @Post()
  create(
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateEmployeeExitDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.employeeExitService.create(employeeId, dto, user.sub);
  }

  @ResponseMessage('Exit details fetched successfully!')
  @Get()
  findOne(@Param('employeeId') employeeId: string) {
    return this.employeeExitService.findOne(employeeId);
  }

  @ResponseMessage('Exit details updated successfully!')
  @Patch()
  update(
    @Param('employeeId') employeeId: string,
    @Body() dto: UpdateEmployeeExitDto,
  ) {
    return this.employeeExitService.update(employeeId, dto);
  }

  @ResponseMessage('Exit revoked successfully!')
  @Delete()
  revoke(@Param('employeeId') employeeId: string) {
    return this.employeeExitService.revoke(employeeId);
  }

  @ResponseMessage('Exit document added successfully!')
  @Post('documents')
  addDocument(
    @Param('employeeId') employeeId: string,
    @Body() dto: ExitDocumentDto,
  ) {
    return this.employeeExitService.addDocument(employeeId, dto);
  }

  @ResponseMessage('Exit document removed successfully!')
  @Delete('documents/:documentId')
  removeDocument(
    @Param('employeeId') employeeId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.employeeExitService.removeDocument(employeeId, documentId);
  }
}
