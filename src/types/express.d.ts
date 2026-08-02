import { Role } from '../generated/prisma/enums.js';

declare global {
  namespace Express {
    interface User {
      sub: string;
      email: string;
      role: Role;
      employeeId?: string;
    }
  }
}
