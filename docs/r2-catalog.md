# Cloudflare R2 catalog

Cloudflare R2 private is the official model and preview store. The backend reconciles its current object inventory into PostgreSQL; React receives catalog changes over SSE.

```text
R2 ListObjectsV2 → backend scheduler → PostgreSQL catalog → PostgreSQL NOTIFY → SSE → React
```

This uses R2's S3-compatible API and works without Workers Paid, R2 Event Notifications, a Queue, a Worker, or a Quick Tunnel. Polling is not webhook real time: direct Dashboard and rclone changes appear after the next scan, normally within the configured 10-minute interval plus scan time.

## Backend configuration

Copy `apps/store-api/.env.example` to `.env` on a new machine. Add or edit these variables without replacing existing credentials:

| Variable | Default | Purpose |
|---|---|---|
| `CATALOG_PROVIDER` | `r2` | Select the R2 catalog |
| `R2_BUCKET` | `3dsmood-models-prod` | Private source bucket |
| `R2_SYNC_ROOT_PREFIX` | `3DSMOOD/` | Object-key prefix to scan; `R2_ROOT_PREFIX` remains a fallback for older `.env` files |
| `R2_ENDPOINT` | — | S3 API endpoint from the bucket settings; use HTTPS, not an `r2.dev` public URL |
| `R2_REGION` | `auto` | S3-compatible client region |
| `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY` | — | Bucket-scoped Object Read credentials; the catalog runtime does not load write credentials |
| `R2_SYNC_ENABLED` | `true` | Enable automatic polling |
| `R2_SYNC_INTERVAL_SECONDS` | `600` | Delay between full metadata scans |
| `R2_SYNC_ON_STARTUP` | `true` | Start the first scan asynchronously after API startup |
| `R2_SYNC_BATCH_SIZE` | `1000` | Maximum ListObjectsV2 page and PostgreSQL write batch (maximum 1000) |
| `R2_WEBHOOK_ENABLED` | `false` | Optional legacy event adapter; leave disabled for polling |

`R2_ACCOUNT_ID` and `R2_EVENT_WEBHOOK_SECRET` are only used if an operator explicitly enables that adapter. Do not put any R2 credentials in `VITE_*`, React, the 3ds Max plugin, or git. Keep Public Access disabled on the bucket.

## Sync behavior

- At startup the API starts listening without waiting for the initial scan. If enabled, it also scans every `R2_SYNC_INTERVAL_SECONDS`.
- Every full scan lists all keys under `R2_SYNC_ROOT_PREFIX` with ListObjectsV2 pagination. R2 does not provide a change cursor through this API, so listing the complete current key set is required to detect deletions reliably.
- List metadata (`ETag`, `Size`, `LastModified`) drives the diff. Unchanged catalog rows are not updated; changed and new rows are batched. A complete listing and PostgreSQL transaction are required before missing objects or categories are marked removed.
- The sync reads R2 metadata only. It does not issue a HEAD or GET per file and does not download previews or archives to build the catalog. Preview requests and licensed archive downloads continue to stream through the backend.
- A PostgreSQL advisory lock serializes scheduled and manual scans across backend instances. A scan failure or incomplete listing leaves the last good catalog in place.
- Sync history and last-success/error status are recorded on each attempt. Catalog version and SSE notifications advance only when categories or models change.

### Categories and models

Every folder below `3DSMOOD/` is a category, identified by its full relative path. Implied folders are included at any depth; an explicit object ending in `/` also identifies an empty folder. R2 has no physical directories, so a truly empty folder without a marker cannot be discovered.

Files are paired by exact basename and same folder. `.jpg`/`.jpeg` and `.zip`/`.rar` extensions are case-insensitive. A preview-only model, archive-only model, ready pair, or conflicting duplicate extensions are represented with status; only a ready pair is downloadable. Archives remain in R2 and are never extracted by the catalog sync.

## First sync and local development

From `apps/store-api`:

```powershell
npm install
npm run check:r2
npm run sync:r2
npm run dev
```

`check:r2` performs a read-only listing and prints counts only. `sync:r2` runs pending PostgreSQL migrations and reconciles the current R2 metadata; it does not write or delete R2 objects. Normal API startup also runs the initial sync when configured. Production should apply migrations with its migration role before deploying the API.

The admin API is `POST /api/admin/catalog/sync`. It requires an authenticated database administrator or a user ID listed in `LICENSE_ADMIN_USER_IDS`; ordinary users cannot start a bucket scan. No shared bootstrap credential is created. `GET /api/admin/catalog/sync/permission` is used by the React admin control to decide whether to show **Sync R2 Now**. See [administrator setup](license-payos-setup.md#trang-quản-trị).

## SSE and React

When PostgreSQL catalog rows change, the transaction sends `NOTIFY` after commit. One shared listener per API process fans out the new version to connected SSE clients at `GET /api/catalog/events`; it does not poll PostgreSQL once per browser. React refetches the category tree and model pages on a change. EventSource reconnects automatically, and a reconnect triggers a fresh read to recover any missed change. Category counts, nested filters, previews, model availability, and model counts update without reloading the page.

`GET /api/catalog/status` reports sync state, model counts, the most recent report, and the last successful full scan. SSE contains only version signals, never credentials or private archive URLs.

## Optional legacy webhook adapter

The existing Worker and Queue source/resources are retained, but the catalog does not depend on them. `R2_WEBHOOK_ENABLED=false` leaves the webhook route unmounted and the inbox worker stopped. Do not enable R2 Event Notifications or change Cloudflare billing for the polling catalog. No Worker, Queue, Tunnel, or Cloudflare resource is created or removed by this project.

The adapter can be enabled later with `R2_WEBHOOK_ENABLED=true` and its secret configured, but it is unnecessary for the current architecture. Its event payloads remain hints; the backend must still check current R2 metadata before applying them.

## Verification

```powershell
cd apps/store-api; npm test
cd ../store-web; npm test; npm run build
```

Use a disposable `TEST_DATABASE_URL` for database integration tests. The read-only `check:r2` command can verify current bucket connectivity without changing production objects.
