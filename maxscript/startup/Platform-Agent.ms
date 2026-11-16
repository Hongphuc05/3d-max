-- Chạy tự động khi Max khởi động (cài vào ENU\scripts\Startup\).
-- Mở agent để panel Platform ở một Max khác import được vào scene của Max này.
global gPlatformNoAutoOpen = true
global gPlatformPreviewRelink
try (
    fileIn ((getDir #userScripts) + "\Platform\PlatformBridge.ms")
    format "[platform] đã nạp PlatformBridge.ms\n"
    -- execute: tên hàm được tra lúc chạy, không phụ thuộc lúc compile file startup này
    execute "pbStartAgent()"
    format "[platform] agent đã chạy\n"
    -- Max was restarted by the plugin update: reopen the panel once Max has finished starting (host sets an env var for that one Max only).
    if (dotNetClass "MaxWebViewHost.MaxWebViewForm").ConsumeReopenPanel() do (
        callbacks.addScript #postSystemStartup "callbacks.removeScripts id:#platformReopenPanel; try (openPlatformPanel()) catch (format \"[platform] reopen panel failed: %\\n\" (getCurrentException()))" id:#platformReopenPanel
        format "[platform] sẽ mở lại panel sau khi Max khởi động xong\n"
    )
    -- Preview Max started by "Open File (cửa sổ Max mới)": relink the copy's textures once it is open (now if it already is, else on open).
    gPlatformPreviewRelink = (dotNetClass "MaxWebViewHost.MaxWebViewForm").ConsumePreviewRelink()
    if gPlatformPreviewRelink != undefined and gPlatformPreviewRelink != "" do (
        if not (execute "pbPreviewRelinkAfterOpen()") do callbacks.addScript #filePostOpen "pbPreviewRelinkAfterOpen()" id:#platformPreviewRelink
        format "[platform] xem trước: sẽ nối lại texture sau khi mở file\n"
    )
) catch (
    format "[platform] không khởi động được agent: %\n" (getCurrentException())
)
gPlatformNoAutoOpen = false
