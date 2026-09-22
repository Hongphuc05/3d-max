# PLAN — Web Platform -> 3ds Max Plugin

## Nguyên tắc
1. Không rewrite platform đang hoạt động.
2. Native plugin là host + capability bridge, không phải frontend thứ hai.
3. Bridge contract được thiết kế trước implementation.
4. Chứng minh integration bằng PoC nhỏ trước asset production.
5. Security boundary nằm ở native side; web input luôn untrusted.

## Phase 0 — Discovery
> Target đã khóa: **Max 2022 / .NET Framework 4.8** ([D1](docs/decisions.md#d1--target-3ds-max-2022-locked)). Không lặp lại câu hỏi này.

### Việc làm
- Audit frontend: framework, routing, auth, CSP, API base URL, download flow. → giải [O1, O2](docs/decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0)
- Audit backend: asset metadata, signed URL/download API, version/checksum.
- Audit asset formats thực tế. → giải [O3](docs/decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0)
- Liệt kê các action web cần Max thực hiện.
- Spike .NET 4.8 + WebView2 + dockable panel trên Max 2022 — điền `docs/compatibility.md`.
- Kiểm tra [R2](docs/decisions.md#r2--assembly-conflict-trong-appdomain-của-max): liệt kê assemblies Max nạp sẵn, đối chiếu dependency của bridge. Làm sớm, đừng chờ nó gãy.
- Hỏi business: kênh phân phối + licensing ([O4, O5](docs/decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0)).

### Deliverables
- `docs/compatibility.md` — không còn ô `?`
- `docs/current-platform-audit.md`
- danh sách bridge methods v1.

### Exit
Có thể mở một WebView2 trong Max 2022 và load một test page. Bảng compatibility đã điền.

## Phase 1 — Native Host PoC
- Tạo solution C# plugin.
- Register/load plugin.
- Tạo dockable panel.
- Embed WebView2.
- Load local test HTML trước, sau đó platform staging route.
- Log startup/shutdown.

Exit: mở/tắt/reopen panel ổn định.

## Phase 2 — Bridge Protocol
- DTO request/response/event.
- Request IDs + timeout.
- Method router allowlist.
- `host.ping`, `host.getInfo`.
- TS wrapper SDK.
- Error serialization.

Exit: JS -> C# -> JS round-trip ổn định.

## Phase 3 — Max Interaction PoC
- `scene.createBox`.
- `scene.getSelection`.
- `scene.getInfo`.
- Main-thread dispatcher.
- Test scene mutation từ WebView button.

Exit: bấm nút web tạo cube trong Max và đọc selection được.

## Phase 4 — Platform Integration
- Route `/extension/3dsmax` hoặc host mode.
- Detect Max host.
- Reuse auth/session.
- Hide browser-only controls nếu cần.
- CSP/origin allowlist.
- Không làm hỏng website bình thường.

Exit: user login/browse platform ngay trong Max.

## Phase 5 — Asset Import Vertical Slice
- `asset.import(assetId)`.
- Backend metadata/download integration.
- Download manager + progress.
- Cache manager.
- Checksum/version.
- Safe unzip.
- Import adapter.
- UI progress/result.

Exit: một asset production thật đi từ platform -> Max scene.

## Phase 6 — Hardening
> Bắt buộc, không phải optional — đây là sản phẩm thương mại ([D3](docs/decisions.md#d3--mục-tiêu-sản-phẩm-thương-mại-locked)).

- Navigation policy.
- No arbitrary script/shell/path bridge.
- Auth/token review.
- Crash/reload/offline testing.
- Test trường hợp WebView2 Runtime vắng mặt.
- Correlation logs + diagnostic export cho support.
- Installer + bootstrap WebView2 Runtime.
- Code signing DLL + installer.
- Update/rollback.

## Phase 7 — Materials/Renderer (nếu platform cần)
- Renderer detection.
- `material.apply` contract.
- Adapter riêng cho Physical/Corona/V-Ray.
- Texture path/remapping.
- Version matrix.

## Phase 8 — Release
- CI build artifacts.
- Signed binaries nếu có hạ tầng signing.
- Installer.
- Staging/production config.
- Upgrade/rollback.
- Support/debug guide.

## Quyết định
Đã khóa (D1–D4) và còn mở (O1–O5): xem [`docs/decisions.md`](docs/decisions.md). Không quyết lại ở đây.
