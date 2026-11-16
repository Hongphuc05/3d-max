// Drag card: decodes only a small JPEG data URL, is click-through/non-activating, follows the pointer and draws thumbnail, label and name.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using MaxWebViewHost;

class DragGhostTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    static string DataUrl(ImageFormat format, int side, Color color, string prefix)
    {
        using (var bmp = new Bitmap(side, side)) using (var g = Graphics.FromImage(bmp)) using (var ms = new MemoryStream())
        { g.Clear(color); bmp.Save(ms, format); return prefix + Convert.ToBase64String(ms.ToArray()); }
    }

    [STAThread]
    static void Main()
    {
        var jpeg = DataUrl(ImageFormat.Jpeg, 96, Color.FromArgb(0, 128, 255), DragGhost.JpegPrefix);
        Check(jpeg.Length <= DragGhost.MaxImageDataUrlLength, "a 96px JPEG fits the budget");
        using (var image = DragGhost.DecodeThumbnail(jpeg)) Check(image != null && image.Width == 96, "a small JPEG data URL decodes");
        Check(DragGhost.DecodeThumbnail(null) == null && DragGhost.DecodeThumbnail("") == null, "no image -> null");
        Check(DragGhost.DecodeThumbnail(DataUrl(ImageFormat.Png, 32, Color.Red, DragGhost.JpegPrefix)) == null, "PNG bytes under a JPEG label are rejected");
        Check(DragGhost.DecodeThumbnail(DataUrl(ImageFormat.Jpeg, 32, Color.Red, "data:image/png;base64,")) == null, "another prefix is rejected");
        Check(DragGhost.DecodeThumbnail(DragGhost.JpegPrefix + "not base64 !!") == null, "garbage base64 is rejected");
        Check(DragGhost.DecodeThumbnail(DragGhost.JpegPrefix + Convert.ToBase64String(new byte[] { 1, 2, 3, 4 })) == null, "bytes that are not an image are rejected");
        Check(DragGhost.DecodeThumbnail(DragGhost.JpegPrefix + new string('A', DragGhost.MaxImageDataUrlLength)) == null, "over the length budget is rejected");
        Check(DragGhost.DecodeThumbnail(@"C:\Users\x\a.jpg") == null && DragGhost.DecodeThumbnail("https://evil.test/a.jpg") == null, "paths and URLs are never loaded");

        Check(DragGhost.PositionFor(new Point(100, 200)) == new Point(100 + DragGhost.CursorOffset.X, 200 + DragGhost.CursorOffset.Y), "the card sits below-right of the pointer");
        using (var ghost = new DragGhost("Pouf LOOMA by 4th HOUSE", "3DSMOOD / MAX", DragGhost.DecodeThumbnail(jpeg)))
        {
            Check(ghost.TopMost && !ghost.ShowInTaskbar && ghost.Size == DragGhost.CardSize, "topmost card, not in the taskbar");
            var ex = GetWindowLongPtr(ghost.Handle, -20).ToInt64();
            Check((ex & 0x20) != 0 && (ex & 0x08000000) != 0 && (ex & 0x80000) != 0, "click-through (WS_EX_TRANSPARENT), never activates, layered");
            ghost.Follow(new Point(500, 400));
            Check(ghost.Location == DragGhost.PositionFor(new Point(500, 400)), "Follow moves the card with the pointer");
            using (var bmp = new Bitmap(DragGhost.CardSize.Width, DragGhost.CardSize.Height))
            {
                using (var g = Graphics.FromImage(bmp)) ghost.Render(g);
                var thumb = bmp.GetPixel(10 + 32, DragGhost.CardSize.Height / 2);
                Check(thumb.B > 200 && thumb.R < 60, "the thumbnail is drawn in the image slot");
                var edge = bmp.GetPixel(DragGhost.CardSize.Width / 2, 0);
                Check(edge.R > 150 && edge.G < 120, "brand red border");
                var dark = bmp.GetPixel(DragGhost.CardSize.Width - 6, DragGhost.CardSize.Height - 12);
                Check(dark.R < 40 && dark.G < 40 && dark.B < 40, "dark card background");
            }
        }
        using (var ghost = new DragGhost(null, "3DSMOOD / MAX", null))
        using (var bmp = new Bitmap(DragGhost.CardSize.Width, DragGhost.CardSize.Height))
        {
            using (var g = Graphics.FromImage(bmp)) ghost.Render(g);
            var slot = bmp.GetPixel(10 + 32, DragGhost.CardSize.Height / 2);
            Check(slot.R > 240 && slot.G > 240 && slot.B > 240, "no thumbnail: white placeholder, no exception, default name");
        }
        Console.WriteLine("All DragGhost tests passed.");
    }
}
