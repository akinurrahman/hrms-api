import { Controller, Get, Post, Body, Patch, Param, Query, Delete } from '@nestjs/common';
import { EmployeeService } from './employee.service.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { ResponseMessage } from '../common/index.js';
import { FindEmployeeDto } from './dto/find-employee.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

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
  findAll(@Query() query: FindEmployeeDto) {
    return this.employeeService.findAll(query);
  }

  @Roles(Role.EMPLOYEE, Role.SITE_ADMIN)
  @ResponseMessage('Profile fetched successfully!')
  @Get('me')
  findMe(@CurrentUser() user:Express.User) {
    return this.employeeService.findOne(user.sub);
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

  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Employee deleted successfully!')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employeeService.remove(id);
  }
}