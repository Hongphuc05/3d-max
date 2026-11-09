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

-- Document identity is independent of the window title: two folders may contain the same filename,
-- and reset/new/reopen can replace an Untitled document without changing its title.
global gPlatformDocumentToken
fn pbAdvanceDocumentToken = (
    gPlatformDocumentToken = ((dotNetClass "System.Guid").NewGuid()).ToString "N"
)
fn pbCurrentScenePath = (maxFilePath + maxFileName)
fn pbTargetInfoJson = (
    "{\"scenePath\":" + (pbJsonStr (pbCurrentScenePath())) +
    ",\"documentToken\":" + (pbJsonStr gPlatformDocumentToken) +
    ",\"objectCount\":" + (objects.count as string) + ",\"selectedCount\":" + (selection.count as string) + "}"
)
pbAdvanceDocumentToken()
callbacks.removeScripts id:#PlatformDocumentIdentity
callbacks.addScript #filePreOpen "pbAdvanceDocumentToken()" id:#PlatformDocumentIdentity persistent:false
callbacks.addScript #systemPreNew "pbAdvanceDocumentToken()" id:#PlatformDocumentIdentity persistent:false
callbacks.addScript #systemPreReset "pbAdvanceDocumentToken()" id:#PlatformDocumentIdentity persistent:false

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

-- sink = nơi trả kết quả: panel (MaxWebViewForm) hoặc agent (PlatformAgent, khi lệnh đến từ Max khác). Cả hai có cùng PostResultJson/PostError.
fn pbSceneScriptAssetsProtected = (
    try (SceneScriptSecurityManager.IsSafeScriptAssetExecutionEnabled())
    catch (
        -- Max 2022 exposes SSSE/language policies, but not the later asset-policy API.
        -- Preserve this supported version; unknown newer interfaces fail closed.
        local build = (maxVersion())[1]
        build >= 24000 and build < 25000
    )
)

fn pbSceneScriptsProtected = (
    try (
        SceneScriptSecurityManager.IsSafeSceneScriptExecutionEnabled #Current and
        SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #MAXScriptSystemCommands #Current and
        SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #Python #Current and
        SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #DotNet #Current and
        pbSceneScriptAssetsProtected()
    ) catch (false)
)

fn pbCollectTextureFile file result = (appendIfUnique result file)

fn pbTextureOwners value result = (
    if value == undefined or (findItem result value) != 0 do return result
    if result.count >= 20000 do throw "Material graph exceeds texture inspection limit."
    append result value
    local count = try (getNumSubMtls value) catch (0)
    for i = 1 to count do pbTextureOwners (getSubMtl value i) result
    count = try (getNumSubTexmaps value) catch (0)
    for i = 1 to count do pbTextureOwners (getSubTexmap value i) result
    -- Some renderer maps and modifiers expose texture slots only as properties.
    for prop in (getPropNames value) do (
        local child = try (getProperty value prop) catch (undefined)
        if (isKindOf child TextureMap) or (isKindOf child Material) do pbTextureOwners child result
        if isKindOf child Array do for item in child where (isKindOf item TextureMap) or (isKindOf item Material) do pbTextureOwners item result
    )
    result
)

-- Work on copied incoming materials only. Asset enumeration covers renderer maps registered
-- with Max; filename properties also cover maps that do not register their assets correctly.
fn pbRelinkImportedTextures nodes resolver = (
    local originals = #(), copies = #(), owners = #(), warnings = #(), resolved = #()
    for node in nodes do (
        if node.material != undefined do (
            local mat = node.material
            local index = findItem originals mat
            if index == 0 do (
                append originals mat
                append copies (copy mat)
                index = originals.count
            )
            node.material = copies[index]
            pbTextureOwners node.material owners
        )
        pbTextureOwners node.baseObject owners
        for modifier in node.modifiers do pbTextureOwners modifier owners
    )
    -- Process leaf maps first so material-level asset enumeration sees their final paths.
    for index = owners.count to 1 by -1 do (
        local owner = owners[index]
        local assets = #(), filenameProps = #()
        try (enumerateFiles owner pbCollectTextureFile assets #localOnly) catch ()
        for prop in (getPropNames owner) do (
            local key = toLower (prop as string)
            if (findString key "filename") != undefined or key == "file" or key == "hdrimapname" do (
                local value = try (getProperty owner prop) catch (undefined)
                if ((isKindOf value String) and value != "") or (isKindOf value Array) do (
                    if isKindOf value String then appendIfUnique assets value
                    else for item in value where (isKindOf item String) and item != "" do appendIfUnique assets item
                    append filenameProps #(prop, value)
                )
            )
        )
        for oldPath in assets where oldPath != "" do (
            local fullPath = resolver.Resolve oldPath
            if fullPath == "" then (
                appendIfUnique warnings (resolver.LastStatus + ": " + oldPath)
            ) else (
                local changed = false
                for pair in filenameProps do (
                    try (
                        if pair[2] == oldPath do (
                            setProperty owner pair[1] fullPath
                            if (getProperty owner pair[1]) == fullPath do changed = true
                        )
                        if (isKindOf pair[2] Array) and (findItem pair[2] oldPath) > 0 do (
                            local replacement = copy (getProperty owner pair[1])
                            for i = 1 to replacement.count where replacement[i] == oldPath do replacement[i] = fullPath
                            setProperty owner pair[1] replacement
                            if (findItem (getProperty owner pair[1]) fullPath) > 0 do changed = true
                        )
                    ) catch ()
                )
                -- Covers asset-backed renderer parameters without conventional filename properties.
                try (if ATSOps.RetargetAssets &owner oldPath fullPath do changed = true) catch ()
                if oldPath == fullPath do changed = true
                if changed then (
                    appendIfUnique resolved fullPath
                    try (owner.reload()) catch ()
                ) else appendIfUnique warnings ("cannot_retarget: " + oldPath)
            )
        )
    )
    #(resolved.count, warnings)
)

fn pbHandleImportFile id args sink = (
    -- Runs on Max's UI thread immediately before merge; no document switch can slip between
    -- this guard and mergeMAXFile/importFile through another queued UI request.
    local expectedToken = args.Param "expectedDocumentToken"
    local expectedPath = args.Param "expectedScenePath"
    if expectedToken == undefined or expectedPath == undefined or expectedToken != gPlatformDocumentToken or expectedPath != (pbCurrentScenePath()) then (
        sink.PostError id "TARGET_SCENE_CHANGED" "Scene đã chọn đã đóng hoặc đổi file. Chọn scene và thử lại."
        return undefined
    )
    local p = args.Param "path"
    if p == undefined or not (doesFileExist p) then (
        sink.PostError id "INVALID_PARAMS" "File import không tồn tại"
        return undefined
    )

    -- Resolve against the protected downloaded-model index, never a path supplied by web UI.
    local resolver = dotNetObject "MaxWebViewHost.TexturePathResolver" p

    local startX = pbNextX()
    local before = for o in objects collect o
    local ext = toLower (getFilenameType p)
    if ext == ".max" and not (pbSceneScriptsProtected()) do (
        sink.PostError id "SCENE_SCRIPT_PROTECTION_REQUIRED" "Bật Safe Scene Script Execution và các mục chặn MAXScript/Python/.NET trong Preferences > Security, rồi khởi động lại 3ds Max."
        return undefined
    )

    -- #noPrompt: không hiện dialog options (dùng setting FBX/OBJ gần nhất)
    local ok = case ext of (
        ".max": mergeMAXFile p #select #mergeDups #renameMtlDups
        default: importFile p #noPrompt
    )

    local added = for o in objects where (findItem before o) == 0 collect o
    if added.count == 0 do (
        sink.PostError id "MAX_OPERATION_FAILED" "Import xong nhưng scene không có object mới"
        return undefined
    )

    local textureReport = pbRelinkImportedTextures added resolver
    if textureReport[2].count > 0 do (
        local notice = "Da import model, nhung mot so texture chua noi duoc duong dan:\n"
        for i = 1 to textureReport[2].count do (
            format "[3dsmood texture] %\n" textureReport[2][i]
            if i <= 12 do notice += "\n" + textureReport[2][i]
        )
        if textureReport[2].count > 12 do notice += "\n... Xem MAXScript Listener de biet day du."
        messageBox notice title:"3dsmood - Texture"
    )

    -- dời cụm object mới sang mép phải scene cũ để không chồng lên nhau
    local minX = 1e9
    for o in added do if o.min.x < minX do minX = o.min.x
    local dx = startX - minX
    for o in added where o.parent == undefined or (findItem added o.parent) == 0 do o.pos.x += dx
    select added
    forceCompleteRedraw()

    sink.PostResultJson id \
        ("{\"imported\":" + (added.count as string) + ",\"file\":" + (pbJsonStr (filenameFromPath p)) +
        ",\"texturesResolved\":" + (textureReport[1] as string) + ",\"textureWarnings\":" + (textureReport[2].count as string) + "}")
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

-- Native-only: host downloaded + verified the new MZP and unpacked it into args.dir. Run its install.ms silently (side-by-side, the
-- running version stays active until install.ms swaps active.txt). Max is NOT closed: the host just tells the user to restart it.
global gPlatformSilentInstall = false
fn pbHandleUpdateInstall id args sink = (
    local dir = args.Param "dir"
    if dir == undefined or not (doesFileExist (dir + "install.ms")) then (
        sink.PostError id "INVALID_PARAMS" "Gói cập nhật không tồn tại"
        return undefined
    )
    local failure = undefined
    gPlatformSilentInstall = true
    try (fileIn (dir + "install.ms")) catch (failure = getCurrentException())
    gPlatformSilentInstall = false
    if failure != undefined then (
        format "[bridge] update.install failed: %\n" failure
        sink.PostError id "UPDATE_INSTALL_FAILED" "Cài bản cập nhật thất bại. Bản hiện tại vẫn dùng được."
    ) else (
        sink.PostResultJson id "{\"restartRequired\":true}"
        sink.NotifyUpdateInstalled()
    )
)

fn pbOnRequest sender args = (
    local id = args.Id
    local m = args.Method
    format "[bridge] % % params=%\n" id m args.ParamsJson

    try (
        case m of (
            -- Native-only agent request; not present in the web bridge allowlist.
            "scene.targetInfo": sender.PostResultJson id (pbTargetInfoJson())
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
            "asset.importFile": pbHandleImportFile id args sender
            -- Native-only (host dispatches it itself); not in the web allowlist.
            "update.install": pbHandleUpdateInstall id args sender
            default: sender.PostError id "UNKNOWN_METHOD" ("Unknown method: " + m)
        )
    )
    catch (
        -- chi tiết vào Listener, UI chỉ nhận message chung (spec §11)
        format "[bridge] EXCEPTION % : %\n" m (getCurrentException())
        sender.PostError id "MAX_OPERATION_FAILED" ("Thao tác thất bại: " + m)
    )
)

-- ---------- khởi động ----------

-- Ưu tiên DLL đã cài trong thư mục user của Max, không có thì rơi về layout dev.
global gPlatformInstallationRoot = getFilenamePath (getSourceFileName())
fn pbDllPath = (
    local installed = gPlatformInstallationRoot + "MaxWebViewHost.dll"
    if doesFileExist installed then installed
    else @"D:\Project\3d-max\plugin-csharp\MaxWebViewHost\MaxWebViewHost\bin\Debug\MaxWebViewHost.dll"
)

-- Giao diện được đóng gói trong app/. Native đọc máy chủ từ plugin-config.json.
-- Máy khách chỉ cần plugin, WebView2 và kết nối Internet.
global gPlatformEnvironmentName = "3dsmood"

-- Agent chạy trong MỌI Max (scripts\Startup\Platform-Agent.ms gọi hàm này) để panel ở Max khác import vào được scene này.
global gPlatformAgent
fn pbStartAgent = (
    local dllPath = pbDllPath()
    if not (doesFileExist dllPath) do return undefined
    (dotNetClass "System.Reflection.Assembly").LoadFrom dllPath
    gPlatformAgent = (dotNetClass "MaxWebViewHost.PlatformAgent").Start()
    dotNet.removeAllEventHandlers gPlatformAgent
    dotNet.addEventHandler gPlatformAgent "SceneRequestReceived" pbOnRequest
    gPlatformAgent
)

-- true khi chỉ nạp file để lấy hàm (startup script), không mở panel
global gPlatformNoAutoOpen

fn openPlatformPanel = (
    local dllPath = pbDllPath()

    if not (doesFileExist dllPath) do (
        messageBox ("Không thấy DLL:\n" + dllPath) title:"3dsmood"
        return undefined
    )

    (dotNetClass "System.Reflection.Assembly").LoadFrom dllPath
    local cls = dotNetClass "MaxWebViewHost.MaxWebViewForm"
    cls.EnvironmentName = gPlatformEnvironmentName
    cls.UsePackagedApp = true
    cls.HostVersion = "3ds Max build " + ((maxVersion())[1] as string)

    gPlatformForm = cls.ShowWindow()
    dotNet.removeAllEventHandlers gPlatformForm          -- chạy lại không bị đăng ký trùng
    dotNet.addEventHandler gPlatformForm "SceneRequestReceived" pbOnRequest
    pbStartAgent()    -- Max chứa panel cũng nhận được lệnh (khi panel đang trỏ vào chính nó thì đi đường local, agent chỉ để dự phòng)
    format "[bridge] packaged app panel mở\n"
    gPlatformForm
)

if gPlatformNoAutoOpen != true do openPlatformPanel()
