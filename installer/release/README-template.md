# Phat hanh mot file `3dsmood-library.mzp`

## Build tren Windows

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-mzp.ps1 -ApiBaseUrl https://3dsmood.io.vn -Version 1.3.3
```

Script build web + plugin trong thu muc output rieng, tao staging duoi `installer\release\out\mzp-stage-<id>\stage`, chay test giai nen ZIP/RAR/7z, sau do tao **`installer\release\out\3dsmood-library.mzp`**. Khong build EXE, khong kem folder cai thu cong hay file huong dan roi. Catalog/preview khong dong goi san; model duoc tai rieng trong plugin.

Neu stage vua duoc build va kiem tra, chi dong goi lai bang:

```powershell
powershell -ExecutionPolicy Bypass -File installer\release\make-release-mzp.ps1 -Version 1.3.3 -StageDirectory installer\release\out\mzp-stage-<id>\stage
powershell -ExecutionPolicy Bypass -File installer\tests\verify-mzp.ps1 -PackagePath installer\release\out\3dsmood-library.mzp
```

MZP chua mot ban runtime, giao dien, cau hinh API, third-party notices, `mzp.run` va script cai. SHA256 cua goi in ra console; co the ghi vao mo ta GitHub Release, khong can them file tai ve.

## Cai trong Max 2022

1. Scripting > Run Script > chon `3dsmood-library.mzp` (hoac keo file vao viewport).
2. Customize > Customize User Interface > Toolbars > Category **3dsmood** > keo nut 3dsmood vao toolbar.
3. Bam nut de mo plugin. WebView2 Evergreen Runtime can co tren may; neu thieu plugin huong dan mo trang tai chinh thuc cua Microsoft.

Installer dung `getDir #userScripts`, `#userStartupScripts`, `#userMacros` cua Max dang chay, khong gan cung ENU. Runtime duoc cai vao `Platform\versions\v-<sha256>`; con tro active chuyen sau khi copy hoan tat. DLL cu khong bi ghi de/xoa. Neu Max da nap ban khac, can khoi dong lai de dung ban moi. Khong xoa cac runtime cu tu dong vi Max khac co the dang su dung chung DLL.

## Phat hanh

Tao GitHub Release va dinh kem **chi `3dsmood-library.mzp`**. Workflow `release` kiem ZIP CRC, cau truc MZP, runtime khong lap, roi upload tam va doi ten nguyen tu tren VPS. Nut web tro toi `/download/3dsmood-library.mzp`. Can trien khai cau hinh nginx moi (Content-Disposition dung ten `.mzp`) cung voi web moi.

`build-installer.ps1`, `make-release-zip.ps1` va tai lieu EXE cu duoc giu de tra cuu/tuong thich; khong dung cho luong phat hanh moi.
