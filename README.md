# 3ds Max Platform Extension

Nhúng web platform hiện có vào Autodesk 3ds Max qua một C#/.NET plugin host chứa WebView2
và một bridge hai chiều, typed, có allowlist giữa JavaScript và Max API.

**Target:** 3ds Max 2022 · .NET Framework 4.8 · sản phẩm thương mại
**Trạng thái:** docs-only, chưa có code. Phase 0 (Discovery) chưa xong.

## Docs

| File | Nội dung |
|---|---|
| [docs/decisions.md](docs/decisions.md) | **Đọc đầu tiên.** D1–D4 đã khóa, O1–O5 còn mở, R1–R3 risks |
| [docs/compatibility.md](docs/compatibility.md) | Ma trận version — còn nhiều ô `?` |
| [spec.md](spec.md) | Kiến trúc, bridge protocol, security, error model |
| [plan.md](plan.md) | Phase 0→8 |
| [roadmap.md](roadmap.md) | Milestone M0→M7 |
| [agent.md](agent.md) | Rules cho coding agent |
| [codex-prompt.md](codex-prompt.md) | Prompt khởi động |

## Blocker hiện tại

Chưa audit repo web platform. Không viết bridge method nào phụ thuộc asset API
trước khi có `docs/current-platform-audit.md`.
