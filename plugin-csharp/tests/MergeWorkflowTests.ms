-- Run only in a dedicated 3dsmaxbatch process; creates its own disposable scene.
global gPlatformNoAutoOpen = true
global gMergeTestError = undefined
global gMergeTestResult = undefined
struct MergeTestArgs (path, fn Param key = path)
struct MergeTestSink (
    fn PostError id code message = (gMergeTestError = code),
    fn PostResultJson id result = (gMergeTestResult = result)
)
(
local repo = (dotNetClass "System.IO.Path").GetFullPath ((getFilenamePath (getSourceFileName())) + "../..")
fileIn (repo + "/maxscript/PlatformBridge.ms")
local protection = createFile (repo + "/storage/drive-merge-security.txt")
format "SSSE=%;MAXSCRIPT=%;PYTHON=%;DOTNET=%;ASSETS=%\n" \
    (try(SceneScriptSecurityManager.IsSafeSceneScriptExecutionEnabled #Current)catch(getCurrentException())) \
    (try(SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #MAXScriptSystemCommands #Current)catch(getCurrentException())) \
    (try(SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #Python #Current)catch(getCurrentException())) \
    (try(SceneScriptSecurityManager.IsSceneScriptExecutionBlocked #DotNet #Current)catch(getCurrentException())) \
    (try(SceneScriptSecurityManager.IsSafeScriptAssetExecutionEnabled())catch(getCurrentException())) to:protection
close protection
local token = (dotNetClass "System.Guid").NewGuid()
local owned = (getDir #temp) + "/3dsmood-merge-" + (token.ToString "N")
makeDir owned
local scene = owned + "/fixture.max"
resetMaxFile #noPrompt
box name:"3DsMoodMergeFixture" width:10 length:10 height:10
saveMaxFile scene quiet:true
resetMaxFile #noPrompt
pbHandleImportFile "fixture" (MergeTestArgs path:scene) (MergeTestSink())
if gMergeTestError != undefined do throw ("Merge failed: " + gMergeTestError)
if objects.count != 1 or gMergeTestResult == undefined do throw "Merge did not return one scene object"
format "PASS protected MAX merge preserves workflow: %\n" gMergeTestResult
-- Simulate an unavailable security API without changing the host's settings.
global pbSceneScriptsProtected
local savedCheck = pbSceneScriptsProtected
pbSceneScriptsProtected = fn deniedCheck = false
gMergeTestError = undefined
pbHandleImportFile "blocked" (MergeTestArgs path:scene) (MergeTestSink())
if gMergeTestError != "SCENE_SCRIPT_PROTECTION_REQUIRED" or objects.count != 1 do throw "Unprotected merge was not blocked"
pbSceneScriptsProtected = savedCheck
format "PASS unprotected MAX merge rejected before scene mutation\n"
deleteFile scene
format "PASS merge tests complete\n"
)
