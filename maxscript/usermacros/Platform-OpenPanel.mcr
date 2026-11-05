-- Macroscript cho nút toolbar. Cài vào:
--   %LOCALAPPDATA%\Autodesk\3dsMax\2022 - 64bit\ENU\usermacros\
-- Sau đó: Customize > Customize User Interface > tab Toolbars > category "3dsmood".

macroScript OpenPlatformPanel
category:"3dsmood"
internalCategory:"Platform"
buttonText:"3dsmood"
toolTip:"3dsmood"
(
    on execute do
    (
        local f = (getDir #userScripts) + "\\Platform\\PlatformBridge.ms"
        if not (doesFileExist f) do
            f = @"D:\Project\3d-max\maxscript\PlatformBridge.ms"   -- fallback layout dev

        if doesFileExist f then fileIn f
        else messageBox "Không thấy PlatformBridge.ms. Chạy installer trước." title:"3dsmood"
    )
)
