# Changelog

## [Unreleased]
### Fixed
- E2E Testing DB Schema Seeding Mismatches
  - Fixed ESM resolution errors natively via file URLs since `__dirname` wasn't accessible in `@swc/register` running `seed-e2e.ts`.
  - Added missing fields for `RepogenWorkOrder` (`sourceType`, `reportType`, `bankName`, `bankType`, `valueSlab`).
  - Corrected `Document` schema bindings (`mimeType` to `contentType`).
  - Enforced correct JSON types and dependencies on `RepogenContractSnapshot` (adding `derivedJson`, removing invalid `patchJson`, `schemaHash`, `warningsJson`).
### Added
- Created `e2e` Playwright UI automated testing framework for End-to-End DOCX Generative pipeline validation. 
  - Validates full `CREATE_PACK` pipeline using polling pattern until ZIP artifacts are ready.
- Integrated deterministic fixtures via `/apps/worker/test/fixtures/e2e/evidence` to simulate `upload` state without requiring Desktop agent workflows.
- Provided `pnpm e2e:repogen` workflow script for complete pipeline setup containing parallel dockers, Postgres migrations, `seed-e2e.ts` run, and `playwright test` automation execution.
