-- Chạy tự động khi Max khởi động (cài vào ENU\scripts\Startup\).
-- Mở agent để panel Platform ở một Max khác import được vào scene của Max này.
global gPlatformNoAutoOpen = true
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
) catch (
    format "[platform] không khởi động được agent: %\n" (getCurrentException())
)
gPlatformNoAutoOpen = false
