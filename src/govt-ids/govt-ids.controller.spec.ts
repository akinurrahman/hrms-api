import { Test, TestingModule } from '@nestjs/testing';
import { GovtIdsController } from './govt-ids.controller';
import { GovtIdsService } from './govt-ids.service';

describe('GovtIdsController', () => {
  let controller: GovtIdsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GovtIdsController],
      providers: [GovtIdsService],
    }).compile();

    controller = module.get<GovtIdsController>(GovtIdsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
