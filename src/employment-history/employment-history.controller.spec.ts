import { Test, TestingModule } from '@nestjs/testing';
import { EmploymentHistoryController } from './employment-history.controller';
import { EmploymentHistoryService } from './employment-history.service';

describe('EmploymentHistoryController', () => {
  let controller: EmploymentHistoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmploymentHistoryController],
      providers: [EmploymentHistoryService],
    }).compile();

    controller = module.get<EmploymentHistoryController>(EmploymentHistoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
