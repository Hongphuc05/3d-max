-- MZP runs this file from its extracted package directory. Never loads DLLs here.
(
    local title = "3DS Mood"
    try
    (
        if (maxVersion())[1] != 24000 do throw "Ban cai nay danh cho 3ds Max 2022."
        local ioFile = dotNetClass "System.IO.File"
        local ioDir = dotNetClass "System.IO.Directory"
        local ioPath = dotNetClass "System.IO.Path"
        local source = getFilenamePath (getSourceFileName())
        local root = (ioPath.GetFullPath ((getDir #userScripts) + "\\Platform")) + "\\"
        local versions = root + "versions\\"
        local payloadId = trimRight (trimLeft (ioFile.ReadAllText (source + "payload-id.txt")))
        if payloadId.count != 66 or not (matchPattern payloadId pattern:"v-*") or (findString payloadId "\\") != undefined or (findString payloadId "/") != undefined do throw "Ma goi cai dat khong hop le."
        for i = 3 to payloadId.count where (findString "0123456789abcdef" payloadId[i]) == undefined do throw "Ma goi cai dat khong hop le."
        local destination = versions + payloadId
        ioDir.CreateDirectory versions
        local staging = versions + ".install-" + (((dotNetClass "System.Guid").NewGuid()).ToString "N")
        ioDir.CreateDirectory staging
        local payload = source + "payload\\"
        -- Copy into a fresh directory. Old DLLs and existing model data are untouched.
        for d in ioDir.GetDirectories payload "*" (dotNetClass "System.IO.SearchOption").AllDirectories do
            ioDir.CreateDirectory (staging + "\\" + (substring d (payload.count + 1) -1))
        for f in ioDir.GetFiles payload "*" (dotNetClass "System.IO.SearchOption").AllDirectories do
            ioFile.Copy f (staging + "\\" + (substring f (payload.count + 1) -1)) false
        if not (ioFile.Exists (staging + "\\MaxWebViewHost.dll")) or not (ioFile.Exists (staging + "\\app\\index.html")) do throw "Goi cai dat thieu tep."
        if ioDir.Exists destination then ioDir.Delete staging true
        else ioDir.Move staging destination

        -- Install launchers first, then atomically select the complete runtime.
        ioDir.CreateDirectory (getDir #userMacros)
        ioDir.CreateDirectory (getDir #userStartupScripts)
        ioFile.Copy (source + "PlatformLoader.ms") (root + "PlatformBridge.ms") true
        ioFile.Copy (source + "Platform-OpenPanel.mcr") ((getDir #userMacros) + "\\Platform-OpenPanel.mcr") true
        ioFile.Copy (source + "Platform-Agent.ms") ((getDir #userStartupScripts) + "\\Platform-Agent.ms") true
        local pointer = root + "active.txt"
        local pending = root + "active-" + (((dotNetClass "System.Guid").NewGuid()).ToString "N") + ".tmp"
        ioFile.WriteAllText pending payloadId
        if ioFile.Exists pointer then
        (
            -- An explicit backup path keeps all three .NET arguments typed as strings.
            local pointerBackup = pending + ".bak"
            ioFile.Replace pending pointer pointerBackup
            try (ioFile.Delete pointerBackup) catch ()
        )
        else ioFile.Move pending pointer
        fileIn ((getDir #userMacros) + "\\Platform-OpenPanel.mcr")
        local restartNeeded = false
        for a in (dotNetClass "System.AppDomain").CurrentDomain.GetAssemblies() where (a.GetName()).Name == "MaxWebViewHost" do
            if (toLower a.Location) != (toLower (destination + "\\MaxWebViewHost.dll")) do restartNeeded = true
        local message = "Da cai 3DS Mood.\n\nCustomize > Customize User Interface > Toolbars\nCategory: Platform > keo nut Platform vao toolbar."
        if restartNeeded do message += "\n\nHay khoi dong lai 3ds Max de nap ban moi."
        messageBox message title:title
    )
    catch (messageBox ("Cai dat chua hoan tat:\n" + getCurrentException()) title:title)
)
