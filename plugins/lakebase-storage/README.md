# Lakebase storage for SuperAgent

Optional DSH bundle implementing the public synchronous `dsh-superagent/storage` API. SQLite users do not install this package. The Engine and application use the same semantic interface for both providers; PostgreSQL SQL and schema live entirely here.

## Build and select

From the repository root, run `pnpm install`, `pnpm build`, then `pnpm --filter dsh-superagent-storage-lakebase build`. Build and pack this directory independently with `pnpm build` and `pnpm pack`. Install the core bundle and this bundle in the **same DSH profile**, keeping both the core storage registry entry and the Lakebase provider entry enabled. Add `dsh-superagent-storage-lakebase` to that profile’s `dsh.profile.bundles` after core; installing a dependency alone does not enable its bundle. With pnpm 11, explicitly approve the `libpq` dependency build (for example, profile-local `pnpm-workspace.yaml` with `allowBuilds: { libpq: true }`) before installing. The plugin peer depends on this refactor's core storage export; an older core bundle is incompatible.

In the main `dsh-superagent` entry:

```yaml
stateDir: /absolute/path/to/instance-state
storage:
  backend: lakebase
  options:
    connectionFile: /absolute/path/to/private/connection-uri
```

Create a DBay Lakebase database dedicated to this instance. Save its PostgreSQL URI in the connection file with owner-only permissions (`chmod 600`). Include exactly one `sslmode=verify-full`, a trusted `sslrootcert` when required, and preserve the endpoint routing options from DBay. URI parameters use percent encoding, including `%20` for spaces. Do not put passwords in the profile, process arguments or logs. Each instance needs its own database and local state directory. A PostgreSQL session advisory lock refuses concurrent owners of one database; shared multi-writer databases are outside this contract.

To select SQLite again, stop the entry and configure `storage: { backend: sqlite, options: {} }`. Backend selection does not copy data. The registry waits at most five seconds for a selected provider to register; missing providers fail explicitly. Removing the provider or losing its session stops intake and the Runtime. Restore the connection and restart the entry; the plugin does not reconnect or replay an uncertain commit.

## Native runtime

`pg-native` uses synchronous libpq calls. No Worker or async storage bridge is involved. Network latency blocks the JavaScript thread; this preserves the existing synchronous transaction contract and should be measured with your workload. Connect/statement timeouts are 15 seconds, lock timeout is five seconds, and idle transactions time out after 60 seconds.

The native addon must match the runtime that loads the plugin. A Node CLI build is not automatically usable in the desktop GUI's Electron runtime. Build/package libpq for that runtime's architecture, Node module ABI and Electron headers; do not share a rebuilt addon between incompatible runtimes. Install this **provider bundle**, as well as core, into the GUI profile. The ordinary workspace installation builds for its current Node runtime and does not prepare a desktop-specific native release.

## Offline import

Stop both source and target instances. Back up the source SQLite file and upgrade the backup to core schema 11 using the SQLite implementation first. The target must contain no user records. Run:

```sh
node lib/import-sqlite.js /absolute/path/to/backup.sqlite /absolute/path/to/private/connection-uri
```

The importer opens SQLite read-only, copies all nine tables with arrival order and queued effects, verifies every copied value, advances identity sequences and commits once. Failure rolls back target writes. A lost COMMIT response is uncertain: inspect the target before retrying. Source schema 10 migration remains the responsibility of the default SQLite adapter. PostgreSQL domain schema 11 and physical schema 1 are checked independently.

## Verification

Core tests run with `pnpm check` and need no PostgreSQL. Provider tests require a disposable TLS PostgreSQL/Lakebase database whose name begins with `superagent-test-`:

```sh
SUPERAGENT_TEST_CONNECTION_FILE=/absolute/path/to/private/test-uri pnpm test
pnpm typecheck
pnpm build
```

The suite resets domain tables; never point it at a working instance. It covers sync transactions, callbacks, records/search/views, receipt ordering, durable effects, strict TLS, exclusive ownership, connection loss, process death, native close/GC, offline import and a controlled Runtime business flow. Its model/DSH host is a fixture; it does not call a real model or create a GitHub PR.

For two concurrent instances, supply a second independently provisioned test database and run `SUPERAGENT_TEST_SECOND_CONNECTION_FILE=/absolute/path/to/private/second-test-uri pnpm test:isolation` along with the first connection-file variable. This checks isolation and refuses duplicate ownership of either database. For a remote DBay run, set `SUPERAGENT_TEST_TIMEOUT_MS=600000` when network round trips make the controlled Runtime flow exceed the default three-minute budget; this changes only the test harness deadline, not database timeouts or assertions.
