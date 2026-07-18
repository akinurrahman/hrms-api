import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { EmployeeService } from './employee.service.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { ResponseMessage } from '../common/index.js';

@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Employee created successfully!')
  @Post()
  create(@Body() createEmployeeDto: CreateEmployeeDto) {
    return this.employeeService.create(createEmployeeDto);
  }
  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Employees fetched successfully!')
  @Get()
  findAll() {
    return this.employeeService.findAll();
  }

  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Employee fetched successfully!')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeeService.findOne(id);
  }

  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Employee details updated successfully!')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.employeeService.update(id, updateEmployeeDto);
  }
}
