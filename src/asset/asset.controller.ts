import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { AssetService } from './asset.service.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { FindAssetDto } from './dto/find-asset.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('assets')
@Roles(Role.SITE_ADMIN)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  @ResponseMessage('Asset created successfully!')
  create(@Body() createAssetDto: CreateAssetDto) {
    return this.assetService.create(createAssetDto);
  }

  @Get()
  @ResponseMessage('Assets fetched successfully!')
  findAll(@Query() query: FindAssetDto) {
    return this.assetService.findAll(query);
  }

  @Get('me')
  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  findMyAssets(
    @CurrentUser() user: Express.User,
    @Query() query: FindAssetDto,
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException(
        'No employee profile linked to this account',
      );
    }
    return this.assetService.findAll(query, user.employeeId);
  }

  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  @Get(':id')
  @ResponseMessage('Asset fetched successfully!')
  findOne(@Param('id') id: string, @CurrentUser() user: Express.User) {
    return this.assetService.findOne(
      id,
      user.employeeId,
      user.role === Role.SITE_ADMIN,
    );
  }

  @Patch(':id')
  @ResponseMessage('Asset updated successfully!')
  update(@Param('id') id: string, @Body() updateAssetDto: UpdateAssetDto) {
    return this.assetService.update(id, updateAssetDto);
  }

  @Delete(':id')
  @ResponseMessage('Asset deleted successfully!')
  remove(@Param('id') id: string) {
    return this.assetService.remove(id);
  }
}
