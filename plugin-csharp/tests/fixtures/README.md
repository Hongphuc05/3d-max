# Archive fixtures

`Rar.rar` and `7Zip.LZMA.7z` are test archives from SharpCompress release 0.50.7:

- https://github.com/adamhathcock/sharpcompress/tree/0.50.7/tests/TestArchives/Archives
- Upstream commit: `b4af8afe6683d019d504954a3b4e4f18b06e2cd6`
- Upstream license: MIT, https://github.com/adamhathcock/sharpcompress/blob/0.50.7/LICENSE.txt

`hidden-local.zip` is a synthetic regression fixture with a ZIP local entry omitted
from its central directory. It verifies that extraction cannot bypass the manifest
or entry count budget. None of these fixtures is published in the model catalog.
