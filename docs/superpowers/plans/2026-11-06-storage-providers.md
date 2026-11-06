# Synchronous storage providers implementation plan

User-approved direction: generic synchronous storage interface plus independent Lakebase plugin; retain SQLite by default. Branch from main; preserve feat/lakebase-storage. No PR, push, GUI-profile mutation or production deployment.

## Design

Core owns a semantic Storage interface extending existing Repositories: typed KV/settings, read views, receipts, durable effect records, atomic/afterCommit and close. Business code cannot access SQL handles. SQLite Store remains the default implementation and preserves historical migrations. Effects keeps dispatch/retry policy while persistence operations move behind EffectRecords.

A Cordis storage-provider registry offers named synchronous factories. Runtime resolves the configured provider before construction; missing providers fail explicitly. Core configuration selects storage.backend and provider-owned storage.options. Connection loss is reported through a generic onUnavailable callback. Core has no Lakebase, PostgreSQL or pg-native dependency.

plugins/lakebase-storage is an independently buildable/installable DSH bundle with a peer dependency on core's exported storage API. It owns the native PG driver, PG Store/SQL/schema, owner lock, TLS, offline importer and native packaging instructions. User chooses the backend; choosing Lakebase requires installing/enabling its bundle. Keep one independent DB per instance.

## Tasks

- [x] Add failing storage-provider and queue-interface tests.
- [x] Define semantic Storage/EffectRecords interfaces and SQLite implementation; preserve Engine and SQLite migrations.
- [x] Remove SQL from Effects, introduce registry/configuration/factory and generic fault cleanup.
- [x] Move Lakebase code and tests to an independent package; export core storage API and build both packages.
- [x] Run complete core suite, provider contracts on SQLite/local TLS PostgreSQL, plugin pack/install checks and controlled Runtime E2E.
- [x] Verify real DBay Lakebase using disposable resources and strict TLS; clean task-created resources.
- [x] Obtain independent code review and fix important findings.
- [x] Compare main with committed result: total, production core, SQLite, plugin, tests, docs, dependencies; distinguish moved code and upstream-only patch.

## Review focus

Same-connection transactions/queue writes; aborted COMMIT and callback ordering; deterministic provider registration and disposal; missing backend must never silently fall back; no native driver in core's install/build; compatible public API; source-preserving import; remote transport failure must stop work; preserve unrelated changes.
