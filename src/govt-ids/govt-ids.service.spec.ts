import { Test, TestingModule } from '@nestjs/testing';
import { GovtIdsService } from './govt-ids.service';

describe('GovtIdsService', () => {
  let service: GovtIdsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GovtIdsService],
    }).compile();

    service = module.get<GovtIdsService>(GovtIdsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
