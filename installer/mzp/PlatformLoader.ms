-- Stable entry point. Every payload version lives in its own directory.
(
    local ioFile = dotNetClass "System.IO.File"
    local ioPath = dotNetClass "System.IO.Path"
    local root = (ioPath.GetFullPath ((getDir #userScripts) + "\\Platform")) + "\\"
    local pointer = root + "active.txt"
    if not (ioFile.Exists pointer) then
        messageBox "Khong tim thay ban cai 3DS Mood. Chay lai file .mzp." title:"3DS Mood"
    else
    (
        local version = trimRight (trimLeft (ioFile.ReadAllText pointer))
        local valid = version.count == 66 and (matchPattern version pattern:"v-*")
        if valid do for i = 3 to version.count where (findString "0123456789abcdef" version[i]) == undefined do valid = false
        if not valid then
            messageBox "Cau hinh ban cai khong hop le. Chay lai file .mzp." title:"3DS Mood"
        else
        (
            local runtime = root + "versions\\" + version + "\\"
            local dll = runtime + "MaxWebViewHost.dll"
            local incompatible = false
            for a in (dotNetClass "System.AppDomain").CurrentDomain.GetAssemblies() where (a.GetName()).Name == "MaxWebViewHost" do
                if (toLower a.Location) != (toLower dll) do incompatible = true
            if incompatible then
                messageBox "Ban moi da duoc cai. Hay khoi dong lai 3ds Max de dung ban moi; scene hien tai khong bi thay doi." title:"3DS Mood"
            else if ioFile.Exists dll then fileIn (runtime + "PlatformBridge.ms")
            else messageBox "Ban cai thieu DLL. Chay lai file .mzp." title:"3DS Mood"
        )
    )
)
