# Todos

## Authentication Module
- Build POST /auth/refresh endpoint
- Build POST /auth/logout endpoint (will delete refreshtoken from the db)
- Build JwtStrategy and JwtAuthGuard so you can protect routes
- Test a protected route end to end

## Employee Module
- Employee module: basic CRUD (create, read, update, delete)
- Bulk upload employees
- Role/designation management
- RBAC guards wired up properly with your two-condition permission system
- Dummy modules to test RBAC


# Postpond for phase 2
- Forgot password flow


## Phase 2
- Add Site model
- Add siteId to User (nullable migration)
- Super admin panel
- Super admin impersonation with audit trail