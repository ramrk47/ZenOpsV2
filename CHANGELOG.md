# Changelog

## [Unreleased]
### Fixed
- E2E Seeding: Resolved Prisma schema mismatches for `RepogenWorkOrder` and `RepogenContractSnapshot`.
- ESM Compatibility: Fixed `__dirname` issues in `seed-e2e.ts` and `repogen.processor.ts` (Worker).
- Role Validation: Corrected JWT roles from `FACTORY_OPERATOR` to `factory_ops` to align with backend controller requirements.
- Playwright Locators: Fixed strict mode violations and timing issues for 'Refresh' and 'Pack & Release' buttons.
### Added
- Portable E2E Framework: Added Playwright tests in `apps/e2e/` for deterministic DOCX generation testing.
- Trigger Script: Added `apps/e2e/trigger-docx.ts` for direct API-based generation verification.
- E2E Workflow: Integrated `pnpm e2e:repogen` script to automate full Docker + Seeding + Test lifecycle.
