import { Test, TestingModule } from '@nestjs/testing';
import { FamilyInfoController } from './family-info.controller.js';
import { FamilyInfoService } from './family-info.service.js';

describe('FamilyInfoController', () => {
  let controller: FamilyInfoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FamilyInfoController],
      providers: [FamilyInfoService],
    }).compile();

    controller = module.get<FamilyInfoController>(FamilyInfoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
