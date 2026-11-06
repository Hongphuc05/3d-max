-- Run in a fresh 3dsmaxbatch process only. Never execute in a customer's working scene.
(
    local repo = maxOps.mxsCmdLineArgs[#repo]
    local work = maxOps.mxsCmdLineArgs[#work]
    local report = work + "\\result.txt"
    local output = createFile report
    try (
        global gPlatformNoAutoOpen = true
        fileIn (repo + "\\maxscript\\PlatformBridge.ms")
        dotNet.loadAssembly (repo + "\\plugin-csharp\\tests\\bin\\TexturePathResolverTests.exe")
        makeDir (work + "\\maps") all:true
        makeDir (work + "\\export") all:true
        local image = bitmap 4 4 color:(color 120 70 30) filename:(work + "\\maps\\diffuse.jpg")
        save image
        close image
        local image2 = bitmap 4 4 color:(color 128 128 128) filename:(work + "\\maps\\bump.png")
        save image2
        close image2
        local entry = work + "\\export\\model.fbx"
        local empty = createFile entry
        close empty
        local resolver = (dotNetClass "TexturePathResolverTests").Create work entry
        local sourceMap = bitmapTexture filename:"diffuse.jpg"
        local mat = standardMaterial diffuseMap:sourceMap bumpMap:(bitmapTexture filename:@"..\maps\bump.png")
        local existing = box name:"existing" material:mat
        local incoming = box name:"incoming" material:mat
        local alsoIncoming = box name:"incoming_shared" material:mat
        local result = pbRelinkImportedTextures #(incoming, alsoIncoming) resolver
        if result[2].count != 0 do throw ("Unexpected warnings: " + (result[2] as string))
        if incoming.material.diffuseMap.filename != (work + "\\maps\\diffuse.jpg") do throw "Diffuse did not become absolute"
        if incoming.material.bumpMap.filename != (work + "\\maps\\bump.png") do throw "Bump did not become absolute"
        if existing.material.diffuseMap.filename != "diffuse.jpg" do throw "Existing scene material was modified"
        if incoming.material != alsoIncoming.material do throw "Imported material instancing was lost"
        format "PASS diffuse/bump absolute; existing material unchanged; incoming instances preserved\n" to:output
        local multi = multiMaterial numsubs:2
        multi[1] = standardMaterial diffuseMap:(bitmapTexture filename:"diffuse.jpg")
        multi[2] = standardMaterial diffuseMap:(bitmapTexture filename:"bump.png")
        local nested = box name:"nested" material:multi
        result = pbRelinkImportedTextures #(nested) resolver
        if result[2].count != 0 or nested.material[2].diffuseMap.filename != (work + "\\maps\\bump.png") do throw "Nested material did not relink"
        format "PASS nested Multi/Sub material textures\n" to:output
        local saved = work + "\\verified.max"
        saveMaxFile saved quiet:true
        resetMaxFile #noPrompt
        loadMaxFile saved quiet:true
        local restored = getNodeByName "incoming"
        if restored.material.diffuseMap.filename != (work + "\\maps\\diffuse.jpg") do throw "Absolute texture path did not survive save/reopen"
        if restored.material.diffuseMap.bitmap.width != 4 do throw "Bitmap cannot be decoded after reopen"
        format "PASS bitmap decodes after save/reopen\nPASS\n" to:output
    ) catch (
        format "FAIL %\n" (getCurrentException()) to:output
    )
    close output
)
