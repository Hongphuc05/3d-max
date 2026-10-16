-- PlatformBridge.ms — handler phía Max cho các method không phải host.*
-- Chạy: fileIn file này (macroscript toolbar làm việc đó), hoặc Scripting > Run Script.
-- Listener phải ở mode MAXScript, không phải Python.

global gPlatformForm

-- ---------- helpers ----------

fn pbJsonStr s = (
    local t = s as string
    t = substituteString t "\\" "\\\\"
    t = substituteString t "\"" "\\\""
    "\"" + t + "\""
)

-- Web input là untrusted: mọi số đều clamp về khoảng hợp lệ, thiếu thì lấy default.
fn pbNum args key defVal minV maxV = (
    local s = args.Param key
    if s == undefined then defVal
    else (
        local v = try (s as float) catch (undefined)
        if v == undefined then defVal
        else if v < minV then minV
        else if v > maxV then maxV
        else v
    )
)

-- Mép phải của scene hiện tại, để design mới không chồng lên design cũ.
fn pbNextX = (
    local maxX = 0.0
    local found = false
    for o in objects do (
        if (not found) or o.max.x > maxX do ( maxX = o.max.x; found = true )
    )
    if found then maxX + 25.0 else 0.0
)

fn pbMkBox nm w d h p col = (
    local b = box name:(uniquename nm) width:w length:d height:h
    b.pos = p
    b.wirecolor = col
    b
)

-- ---------- design builders: ghép từ primitive, không cần asset file ----------

fn pbDesk w d h col = (
    local topT = 4.0, legT = 6.0
    local parts = #(pbMkBox "Desk_Top" w d topT [0, 0, h - topT] col)
    for sx in #(-1, 1) do for sy in #(-1, 1) do
        append parts (pbMkBox "Desk_Leg" legT legT (h - topT) \
            [sx * (w/2 - legT/2), sy * (d/2 - legT/2), 0] col)
    parts
)

fn pbChair w d h col = (
    local seatH = h * 0.45, seatT = 4.0, legT = 4.0
    local parts = #(pbMkBox "Chair_Seat" w d seatT [0, 0, seatH - seatT] col)
    for sx in #(-1, 1) do for sy in #(-1, 1) do
        append parts (pbMkBox "Chair_Leg" legT legT (seatH - seatT) \
            [sx * (w/2 - legT/2), sy * (d/2 - legT/2), 0] col)
    append parts (pbMkBox "Chair_Back" w legT (h - seatH) [0, -(d/2 - legT/2), seatH] col)
    parts
)

fn pbShelf w d h n col = (
    local t = 3.0
    local parts = #()
    for sx in #(-1, 1) do
        append parts (pbMkBox "Shelf_Side" t d h [sx * (w/2 - t/2), 0, 0] col)
    local inner = w - 2 * t
    local gap = (h - t) / (n as float)
    for i = 0 to n do
        append parts (pbMkBox "Shelf_Board" inner d t [0, 0, i * gap] col)
    parts
)

fn pbSofa w d h col = (
    local armW = 18.0, seatH = h * 0.5
    local parts = #(pbMkBox "Sofa_Base" w d seatH [0, 0, 0] col)
    append parts (pbMkBox "Sofa_Back" w (d * 0.25) (h - seatH) \
        [0, -(d/2 - d * 0.125), seatH] col)
    for sx in #(-1, 1) do
        append parts (pbMkBox "Sofa_Arm" armW d ((h - seatH) * 0.8) \
            [sx * (w/2 - armW/2), 0, seatH] col)
    parts
)

-- ---------- asset import: path do host tính (không phải web gửi), chạy trên UI thread ----------

fn pbHandleImportFile id args = (
    local p = args.Param "path"
    if p == undefined or not (doesFileExist p) then (
        gPlatformForm.PostError id "INVALID_PARAMS" "File import không tồn tại"
        return undefined
    )

    local startX = pbNextX()
    local before = for o in objects collect o
    local ext = toLower (getFilenameType p)

    -- #noPrompt: không hiện dialog options (dùng setting FBX/OBJ gần nhất)
    local ok = case ext of (
        ".max": mergeMAXFile p #select #mergeDups #useMergedMtlDups
        default: importFile p #noPrompt
    )

    local added = for o in objects where (findItem before o) == 0 collect o
    if added.count == 0 do (
        gPlatformForm.PostError id "MAX_OPERATION_FAILED" "Import xong nhưng scene không có object mới"
        return undefined
    )

    -- dời cụm object mới sang mép phải scene cũ để không chồng lên nhau
    local minX = 1e9
    for o in added do if o.min.x < minX do minX = o.min.x
    local dx = startX - minX
    for o in added where o.parent == undefined or (findItem added o.parent) == 0 do o.pos.x += dx
    select added
    forceCompleteRedraw()

    gPlatformForm.PostResultJson id \
        ("{\"imported\":" + (added.count as string) + ",\"file\":" + (pbJsonStr (filenameFromPath p)) + "}")
)

-- ---------- router ----------

fn pbHandleDesign id args = (
    local t = args.Param "type"
    local w = pbNum args "width"  100.0 1.0 10000.0
    local d = pbNum args "depth"   60.0 1.0 10000.0
    local h = pbNum args "height"  75.0 1.0 10000.0
    local n = (pbNum args "shelves" 4.0 1.0 20.0) as integer
    local col = color (pbNum args "r" 150.0 0.0 255.0) \
                      (pbNum args "g" 150.0 0.0 255.0) \
                      (pbNum args "b" 150.0 0.0 255.0)
    local startX = pbNextX()

    local parts = case t of (
        "desk":  pbDesk w d h col
        "chair": pbChair w d h col
        "shelf": pbShelf w d h n col
        "sofa":  pbSofa w d h col
        default: undefined
    )

    if parts == undefined then
        gPlatformForm.PostError id "INVALID_PARAMS" ("Unknown design type: " + (t as string))
    else (
        local g = group parts name:(uniquename (t + "_"))
        g.pos.x = startX + w / 2
        select g
        gPlatformForm.PostResultJson id \
            ("{\"name\":" + (pbJsonStr g.name) + ",\"parts\":" + (parts.count as string) + "}")
    )
)

fn pbOnRequest sender args = (
    local id = args.Id
    local m = args.Method
    format "[bridge] % % params=%\n" id m args.ParamsJson

    try (
        case m of (
            "scene.getInfo": (
                gPlatformForm.PostResultJson id (
                    "{\"objects\":" + (objects.count as string) +
                    ",\"selected\":" + (selection.count as string) +
                    ",\"units\":" + (pbJsonStr (units.DisplayType as string)) +
                    ",\"renderer\":" + (pbJsonStr (renderers.current as string)) + "}")
            )
            "scene.getSelection": (
                local names = ""
                for o in selection do (
                    if names != "" do names += ","
                    names += pbJsonStr o.name
                )
                gPlatformForm.PostResultJson id \
                    ("{\"count\":" + (selection.count as string) + ",\"names\":[" + names + "]}")
            )
            "scene.createBox": (
                local s = pbNum args "size" 20.0 1.0 10000.0
                local x = pbNextX()
                local b = box name:(uniquename "BridgeBox") width:s length:s height:s
                b.pos = [x + s/2, 0, 0]
                gPlatformForm.PostResultJson id ("{\"name\":" + (pbJsonStr b.name) + "}")
            )
            "design.create": pbHandleDesign id args
            "asset.importFile": pbHandleImportFile id args
            default: gPlatformForm.PostError id "UNKNOWN_METHOD" ("Unknown method: " + m)
        )
    )
    catch (
        -- chi tiết vào Listener, UI chỉ nhận message chung (spec §11)
        format "[bridge] EXCEPTION % : %\n" m (getCurrentException())
        gPlatformForm.PostError id "MAX_OPERATION_FAILED" ("Thao tác thất bại: " + m)
    )
)

-- ---------- khởi động ----------

-- Ưu tiên DLL đã cài trong thư mục user của Max, không có thì rơi về layout dev.
fn pbDllPath = (
    local installed = (getDir #userScripts) + "\\Platform\\MaxWebViewHost.dll"
    if doesFileExist installed then installed
    else @"D:\Project\3d-max\plugin-csharp\MaxWebViewHost\MaxWebViewHost\bin\Debug\MaxWebViewHost.dll"
)

-- Phase 4: host nạp website thật qua URL (Vite dev server), không còn nạp file HTML cố định.
-- Đổi 3 giá trị này khi target staging/production.
global gPlatformStartUrl = "http://localhost:5173"
global gPlatformTrustedOrigins = "http://localhost:5173,http://localhost:5001"
global gPlatformEnvironmentName = "development"
global gPlatformApiBase = "http://localhost:5173"   -- store-api qua proxy Vite; phải nằm trong gPlatformTrustedOrigins

fn openPlatformPanel = (
    local dllPath = pbDllPath()

    if not (doesFileExist dllPath) do (
        messageBox ("Không thấy DLL:\n" + dllPath) title:"Platform"
        return undefined
    )

    (dotNetClass "System.Reflection.Assembly").LoadFrom dllPath
    local cls = dotNetClass "MaxWebViewHost.MaxWebViewForm"
    cls.StartUrl = gPlatformStartUrl
    cls.TrustedOrigins = gPlatformTrustedOrigins
    cls.EnvironmentName = gPlatformEnvironmentName
    cls.ApiBase = gPlatformApiBase
    cls.HostVersion = "3ds Max build " + ((maxVersion())[1] as string)

    gPlatformForm = cls.ShowWindow()
    dotNet.removeAllEventHandlers gPlatformForm          -- chạy lại không bị đăng ký trùng
    dotNet.addEventHandler gPlatformForm "SceneRequestReceived" pbOnRequest
    format "[bridge] panel mở, StartUrl = %\n" gPlatformStartUrl
    gPlatformForm
)

openPlatformPanel()
