-- Run only in a dedicated 3dsmaxbatch process; creates its own disposable scene.
global gPlatformNoAutoOpen = true
global gMergeTestError = undefined
global gMergeTestResult = undefined
struct MergeTestArgs (
    path, expectedScenePath, expectedDocumentToken,
    fn Param key = case key of (
        "path": path
        "expectedScenePath": expectedScenePath
        "expectedDocumentToken": expectedDocumentToken
        default: undefined
    )
)
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
local untitledToken = gPlatformDocumentToken
resetMaxFile #noPrompt
if gPlatformDocumentToken == untitledToken do throw "Reset of Untitled did not rotate document identity"
format "PASS same-title Untitled reset invalidates old document generation\n"
box name:"3DsMoodMergeFixture" width:10 length:10 height:10
saveMaxFile scene quiet:true
local reopenToken = gPlatformDocumentToken
local reopenPath = pbCurrentScenePath()
loadMaxFile scene quiet:true
if gPlatformDocumentToken == reopenToken do throw "Reopening the same file did not rotate document identity"
pbHandleImportFile "stale-reopen" (MergeTestArgs path:scene expectedScenePath:reopenPath expectedDocumentToken:reopenToken) (MergeTestSink())
if gMergeTestError != "TARGET_SCENE_CHANGED" or objects.count != 1 do throw "Stale reopened document token mutated the scene"
format "PASS same-path reopened file rejects stale token before scene mutation\n"
resetMaxFile #noPrompt
gMergeTestError = undefined
pbHandleImportFile "fixture" (MergeTestArgs path:scene expectedScenePath:(pbCurrentScenePath()) expectedDocumentToken:gPlatformDocumentToken) (MergeTestSink())
if gMergeTestError != undefined do throw ("Merge failed: " + gMergeTestError)
if objects.count != 1 or gMergeTestResult == undefined do throw "Merge did not return one scene object"
format "PASS protected MAX merge preserves workflow: %\n" gMergeTestResult
gMergeTestError = undefined
pbHandleImportFile "stale-path" (MergeTestArgs path:scene expectedScenePath:scene expectedDocumentToken:gPlatformDocumentToken) (MergeTestSink())
if gMergeTestError != "TARGET_SCENE_CHANGED" or objects.count != 1 do throw "Stale path mutated the selected scene"
format "PASS stale full scene path rejected before scene mutation\n"
-- Simulate an unavailable security API without changing the host's settings.
global pbSceneScriptsProtected
local savedCheck = pbSceneScriptsProtected
pbSceneScriptsProtected = fn deniedCheck = false
gMergeTestError = undefined
pbHandleImportFile "blocked" (MergeTestArgs path:scene expectedScenePath:(pbCurrentScenePath()) expectedDocumentToken:gPlatformDocumentToken) (MergeTestSink())
if gMergeTestError != "SCENE_SCRIPT_PROTECTION_REQUIRED" or objects.count != 1 do throw "Unprotected merge was not blocked"
pbSceneScriptsProtected = savedCheck
format "PASS unprotected MAX merge rejected before scene mutation\n"
deleteFile scene
format "PASS merge tests complete\n"
)
