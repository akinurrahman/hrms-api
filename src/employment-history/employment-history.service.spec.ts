import { Test, TestingModule } from '@nestjs/testing';
import { EmploymentHistoryService } from './employment-history.service';

describe('EmploymentHistoryService', () => {
  let service: EmploymentHistoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmploymentHistoryService],
    }).compile();

    service = module.get<EmploymentHistoryService>(EmploymentHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
