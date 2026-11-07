# Models and Scenes rollout

The library has two content domains: `3dmodels` and `3dscenes`. They share device licenses, import targets and the download queue. Each has its own categories, preview/archive matching and admin/plugin library tab. Scenes merge into the selected Max window.

## Preview data

Production `PREVIEW_DIR` is normally `/var/lib/3dsmood/previews-v3`. New image uploads create:

```text
previews-v3/
  3dmodels/<derived-image-sha256>.webp
  3dscenes/<derived-image-sha256>.webp
```

The original source image is converted to two WebP variants (480px and 1400px maximum width); originals are not retained by the server. Matching is by normalized filename stem **within the content domain**. Preview category paths have variable depth, for example `Exterior` and `Interior/Bedroom`.

One scene can belong to multiple categories. Identical scene previews in different categories share a canonical model and preview data; the archive is downloaded once. Conflicting same-stem images must be reviewed rather than silently replaced. Existing Models collision rules remain stricter.

The supplied local `3DSCENES` folder contains 49 images / 48 normalized stems, 48,884,014 bytes. `1116753112.jpeg` appears identically in `Exterior` and `Interior/Other`; both memberships are intentional. Source previews and upload reports are excluded from Git.

A read-only Drive API audit on 2026-11-07 visited 14 folders and found 49 archives. Every local preview matched an archive stem, and every archive had a local preview. The two `1116753112.rar` copies have equal Drive MD5 and size (457,898,262 bytes), so they can use one canonical download. This audit verifies metadata/pairing; it does not extract or render scene archives.

## Local audit and resumable upload

Run from the repository root with Node 26:

```powershell
node tools/preview-library.mjs --root 3DSCENES --domain 3dscenes --report data/scenes-audit.json
```

The tool checks filenames, categories, file sizes and duplicate content before uploading anything. The normal admin image endpoint still validates image bytes, pixel dimensions and authorization.

After the new API is deployed, authenticate using `PREVIEW_ADMIN_COOKIE` or both `PREVIEW_ADMIN_EMAIL` and `PREVIEW_ADMIN_PASSWORD` in the process environment. Do not put passwords/session cookies in command arguments, committed files or logs.

```powershell
node tools/preview-library.mjs --root 3DSCENES --domain 3dscenes --upload --origin https://3dsmood.io.vn --report data/scenes-upload.json
```

Uploads run sequentially to limit VPS resource usage. Each result is written immediately. Rerun with the same report to resume unchanged successful files for the same origin/domain. Use a separate report for audits so an audit does not replace upload progress. Resume assumes the server records have not subsequently been deleted; use a new report after manual server changes. `--replace` explicitly permits replacing previews already installed in the same category; normal uploads do not replace them.

The tool only sends preview images; it does not upload archives or change Drive. Scenes are public when both archive and preview are paired. A successful image upload may therefore be `PREVIEW_ONLY` until Drive synchronization finishes.

## Deployment and checks

1. Deploy API migrations and web UI together. Confirm both admin tabs and their independent category trees.
2. Confirm Models and Scenes FULL sync jobs finish for the `3DSMOOD` Drive source. Inspect failures/review items; do not infer completion just from deployment health.
3. Upload the audited Scenes preview folder. Check 48 canonical scene stems and both memberships of `1116753112` (actual published count depends on matching archives).
4. Verify representative `/previews/3dmodels/<sha>.webp` and `/previews/3dscenes/<sha>.webp` requests return WebP data. Old flat Models preview URLs must continue working.
5. Existing Models flat blobs remain usable through the API fallback. In the API directory with the production environment loaded, run `node scripts/relocate-previews.js` for an audit, then `node scripts/relocate-previews.js --apply` to copy verified Models data into `3dmodels/` and update references. Old files remain for compatibility; this is not a deletion operation.
6. The Nginx template serves both namespaces directly. Updating this template in Git does not change the installed root-owned VPS configuration. Existing `/previews/` proxy routing supports the new paths meanwhile; apply and validate Nginx configuration through the normal operator process when access is available.
7. Install the updated MZP on a test machine. Verify Models/Scenes, Online/Downloaded, repeated local imports, the selected Max target, bitmap paths, shared license and offline behavior.

Catalog requests opt into the mixed catalog with `X-3dsmood-Content-Domains: 1`. The updated plugin and frontend send this capability header. Requests without it receive the legacy Models-only response and flat preview URLs, with Models-path fallback for newly uploaded images. Each representation has its own checksum/ETag and responses vary by capability, so an updated native build cannot reuse an older Models-only cache after a 304 response.

Install the updated MZP to use Scenes. Native tests do not replace a real interactive 3ds Max import/render check.

## Verified implementation status (2026-11-07)

- API: 407 tests passed against isolated PostgreSQL schemas, no skips.
- Web: 174 tests passed; production build succeeded.
- Preview import tooling: four tests passed, including interrupted upload/resume and refusing an unscoped legacy API.
- All 49 supplied source images decode successfully within the server's pixel limit.
- Native cache, routes, downloads, device sessions, selected-Max routing and packaged WebView checks passed. Final capability-header changes were rechecked in affected native suites.
- MZP version 1.4.0 built with fresh frontend and native binaries; staged ZIP/RAR/7z extraction and package corruption-rejection checks passed. SHA256: `F0AF6971D566AC74CA791806FEC4215C247F83A13AC7A94E0463DA96E824EF2E`.
- No interactive licensed Max scene merge/render has been performed for Scenes. Production verification is recorded below separately from local tests.

## Production verification (2026-11-07)

Deployment of `bb63e79` completed successfully in GitHub Actions run `42352816700`. Verified VPS account roles: `ci` uploads/deploys code, `dsmood` runs API and worker, and the separate `3dsmood` SSH account has administrative sudo access. No root SSH configuration change was needed.

Both automatic FULL jobs completed without errors: Models scanned 126 folders / 720 files; Scenes scanned 14 folders / 98 files and registered 48 canonical scenes from 49 archives. All 49 supplied previews uploaded successfully through the admin API and are paired (`FULL`). The duplicate `1116753112` appears in both Exterior and Interior / Other.

A verified database backup was made before changing preview references. Relocation copied and verified all 640 existing Models preview blobs, then updated their references to `3dmodels/`; legacy flat files remain. Scenes uses 96 WebP blobs under `3dscenes/`. The resulting directories occupy approximately 37 MiB and 8 MiB respectively.

Public HTTPS verification at catalog version 50 confirmed:

- Modern catalog: 318 Models and 48 Scenes; legacy catalog: 318 Models, no Scenes.
- All 96 public Scenes preview URLs return bytes matching their manifest SHA256 and file sizes.
- Every one of the 49 requested category memberships exists; both duplicate memberships are present.
- Sample legacy flat and modern Models preview URLs both return the expected image hashes.
- The gallery download serves MZP 1.4.0 (9,770,007 bytes), matching the local package SHA256 above, with `application/octet-stream` and attachment filename `3dsmood-library.mzp`.
- The installed Nginx configuration now directly serves scoped previews and correct MZP headers; syntax check and reload succeeded. API, worker and Nginx are active.
- The short-lived operator upload session was removed after completion.

On-server upload results, the pre-upload database backup and previous installer are kept under `/var/lib/3dsmood/scenes-preview-rollout/`. Local audit and public verification reports remain in ignored `data/`; source image originals and credentials are not committed.

## Separate local download folders (MZP 1.4.1)

Settings exposes independent native folder pickers for Models and Scenes. The existing Models location is retained. Scenes defaults to the Windows Documents folder under `3DS Mood/Scenes`; either location can be changed independently and is saved in the protected local index. Older indexes initialize the new Scenes setting without moving downloaded contents.

Native download routing reads the product's content domain from the cached catalog, while JavaScript passes only the requested domain to the folder picker. Neither bridge call accepts a filesystem path from JavaScript. Changing either setting affects subsequent downloads; already downloaded products continue to import from their recorded directory without downloading or extracting again.

Validation: web 175 tests; downloaded-library 71 checks (including legacy settings migration, independent folders, actual Scene extraction root, persistence and stable existing imports); WebView transport 43 checks. Release x64 and fresh frontend builds, staged ZIP/RAR/7z extraction and MZP structure checks passed. Package version 1.4.1 SHA256: `15A06566C8D4039A96B2BC080E8D06104352C1852D9FC92370B97D859D44F3CA`.
