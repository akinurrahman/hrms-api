import { Test, TestingModule } from '@nestjs/testing';
import { FamilyInfoService } from './family-info.service';

describe('FamilyInfoService', () => {
  let service: FamilyInfoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FamilyInfoService],
    }).compile();

    service = module.get<FamilyInfoService>(FamilyInfoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
