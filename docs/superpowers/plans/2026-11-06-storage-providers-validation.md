# Storage provider refactor verification

Branch: `refactor/storage-providers`. Baseline: upstream `main` at `8c32a9d`. Original implementation remains on `feat/lakebase-storage`.

## Implemented split

- `725b424 refactor(storage): expose synchronous provider contract`: generic core, default SQLite, provider lifecycle, public storage entry and shared contract tests.
- Separate follow-up commit: optional `plugins/lakebase-storage`, its native driver/schema/SQL/importer/tests/build metadata, and this implementation's design/acceptance documents.
- Engine source (`src/core`) has no changes. Sixteen existing application files change only their concrete Store type import to the semantic Storage type. Runtime, Effects and deployment wiring carry the behavior changes.

## Executed checks

- Core `pnpm check`: 61 test files, 1,207 tests passed, TypeScript and production build passed. SQLite remains the default.
- Shared storage contract is invoked unchanged on SQLite and PostgreSQL: synchronous nested rollback and callbacks, settings persistence/reopen, arrival order/escaped search, receipt ordering/idempotence and effects commit/rollback.
- Local PostgreSQL 17 with strict TLS: all 19 tests in six plugin suites passed. Includes aborted-COMMIT protection, exclusive ownership, certificate mismatch rejection, connection-loss shutdown, native close/GC and killed-process rollback.
- Provider source and test TypeScript checks plus standalone provider build passed.
- Core and provider tarballs built separately. Core archive contains no provider package or PG dependency; root dependencies remain proper-lockfile and zod. Provider owns pg-native and zod.
- Real DSH 0.2.2-rc.1: installed both tarballs into an isolated web profile, explicitly approved libpq build and enabled the provider bundle. Booted with Lakebase backend against local TLS PostgreSQL; management overview returned 200 and its person/executor/flow/problems fields were verified. PostgreSQL contained the instance master-id and one active SuperAgent session. Closed the test DSH host afterward.
- Independent review completed. Its stop/reentrancy edge was reproduced, fixed and covered. Immediate intake rejection after connection loss was also reproduced and fixed; no failed assertion was removed.

## Remote acceptance

- DBay.cloud on 2026-11-06, strict certificate and hostname verification: all six suites / 19 tests passed in 497.71 seconds against a dedicated temporary Lakebase database.
- Separate two-database acceptance: one test passed in 27.79 seconds. Two simultaneous providers persisted isolated values, and duplicate ownership of either database was rejected.
- Both task-created cloud databases were deleted and individually re-queried as DELETED. The local TLS PostgreSQL container, isolated DSH process and CONNECT tunnel were closed. No existing database, security group, deployment or daily GUI profile was changed.

## Scope limits

The controlled Runtime test exercises intake → decision → worker launch → follow-up → stop → management reads, using real persistence and a fixture DSH/model host. It does not call a real model or create a GitHub PR. The installed DSH check proves real loader/bundle/native integration and management API, while its account setup remains deliberately unconfigured.

CLI native packaging was validated for the current Node runtime. A desktop Electron native artifact was not rebuilt or installed in the user's daily profile in this refactor. The plugin README explains the separate ABI requirement.

Remote latency matters with a synchronous driver: this preserves the existing interface but blocks the JavaScript thread during PG round trips. The initial remote Runtime test hit its 180-second harness deadline; the remote run uses 600 seconds without changing database timeouts or business assertions. Initial failure and final results remain in ignored local artifacts.

## Comparison with main

The upstream-focused core commit alone changes **42 files, +463 / -82 lines**. Its production source is **28 files, +265 / -71**, including 16 type-import-only files. The Engine has no changes.

| Scope | Files | Added | Deleted |
| --- | ---: | ---: | ---: |
| Core production source | 28 | 265 | 71 |
| Core tests and shared fixtures | 8 | 166 | 7 |
| Core package/bundle/build wiring | 3 | 8 | 2 |
| Core docs plus design and acceptance records | 6 | 170 | 2 |
| Lakebase provider source | 9 | 546 | 0 |
| Lakebase provider tests | 8 | 271 | 0 |
| Lakebase provider docs and build metadata | 8 | 158 | 0 |
| Workspace and dependency lock | 2 | 139 | 0 |
| **Total** | **72** | **1723** | **82** |

Counts are Git additions/deletions relative to main, including newly tracked files; they are not an estimate of novel logic. SQLite effect SQL was moved from Effects; Lakebase code was moved/refactored from the preserved earlier branch and is new only relative to upstream main. All commits are local; no PR or push was made.
