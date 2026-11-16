using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MaxWebViewHost
{
    /// <summary>Card that follows the mouse while a model is dragged out of the panel (thumbnail, "3DSMOOD / MAX", model name), like other asset
    /// browsers do. It is click-through (WS_EX_TRANSPARENT) and never activates, so it can never receive the drop itself.</summary>
    internal sealed class DragGhost : Form
    {
        internal static readonly Size CardSize = new Size(300, 84);
        internal static readonly Point CursorOffset = new Point(18, 14);   // card sits below-right of the pointer
        private const int MaxImageSide = 512;
        internal const int MaxImageDataUrlLength = 12000;   // the whole bridge message is capped at 16384 chars
        internal const string JpegPrefix = "data:image/jpeg;base64,";
        private static readonly Color Surface = Color.FromArgb(18, 18, 20);
        private static readonly Color Brand = Color.FromArgb(229, 72, 77);   // #e5484d
        private readonly Image thumbnail;
        private readonly string title;
        private readonly string label;

        internal DragGhost(string title, string label, Image thumbnail)
        {
            this.title = string.IsNullOrWhiteSpace(title) ? "Model" : title.Trim();
            this.label = label ?? "";
            this.thumbnail = thumbnail;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Size = CardSize;
            BackColor = Surface;
            Opacity = 0.94;
            DoubleBuffered = true;
            using (var path = Rounded(new Rectangle(Point.Empty, CardSize), 8)) Region = new Region(path);
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            // WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_LAYERED: invisible to hit-testing, so drops go to what is underneath
            get { var cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000020 | 0x00080000; return cp; }
        }

        internal static Point PositionFor(Point cursor) { return new Point(cursor.X + CursorOffset.X, cursor.Y + CursorOffset.Y); }
        internal void Follow(Point cursor) { var at = PositionFor(cursor); if (Location != at) Location = at; }

        /// <summary>JPEG thumbnail sent by the panel as a data URL; null when absent or not a small valid JPEG (the card then shows the name only).</summary>
        internal static Image DecodeThumbnail(string dataUrl)
        {
            if (string.IsNullOrEmpty(dataUrl) || dataUrl.Length > MaxImageDataUrlLength || !dataUrl.StartsWith(JpegPrefix, StringComparison.Ordinal)) return null;
            try
            {
                var bytes = Convert.FromBase64String(dataUrl.Substring(JpegPrefix.Length));
                using (var stream = new MemoryStream(bytes))
                using (var image = Image.FromStream(stream, false, true))
                {
                    if (!image.RawFormat.Equals(ImageFormat.Jpeg) || image.Width < 1 || image.Height < 1 || image.Width > MaxImageSide || image.Height > MaxImageSide) return null;
                    return new Bitmap(image);   // copy: the stream is closed after this
                }
            }
            catch (Exception e) when (e is FormatException || e is ArgumentException || e is OutOfMemoryException || e is ExternalException) { return null; }
        }

        protected override void OnPaint(PaintEventArgs e) { Render(e.Graphics); }

        internal void Render(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            g.Clear(Surface);
            const int pad = 10, imageSide = 64;
            var imageRect = new Rectangle(pad, (CardSize.Height - imageSide) / 2, imageSide, imageSide);
            using (var clip = Rounded(imageRect, 4))
            {
                using (var white = new SolidBrush(Color.White)) g.FillPath(white, clip);
                if (thumbnail != null)
                {
                    var state = g.Save();
                    g.SetClip(clip);
                    g.DrawImage(thumbnail, Cover(thumbnail.Size, imageRect));
                    g.Restore(state);
                }
            }
            var textLeft = imageRect.Right + 12;
            var textWidth = CardSize.Width - textLeft - pad;
            using (var small = new Font("Segoe UI", 8f, FontStyle.Bold))
            using (var big = new Font("Segoe UI", 10.5f, FontStyle.Bold))
            {
                var flags = TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
                TextRenderer.DrawText(g, label, small, new Rectangle(textLeft, 18, textWidth, 16), Brand, flags);
                TextRenderer.DrawText(g, title, big, new Rectangle(textLeft, 38, textWidth, 24), Color.White, flags);
            }
            using (var border = new Pen(Brand, 1.5f))
            using (var outline = Rounded(new Rectangle(0, 0, CardSize.Width - 1, CardSize.Height - 1), 8))
                g.DrawPath(border, outline);
        }

        // Fill the square like CSS object-fit: cover (crop the longer side).
        private static Rectangle Cover(Size image, Rectangle box)
        {
            var scale = Math.Max((double)box.Width / image.Width, (double)box.Height / image.Height);
            int w = (int)Math.Ceiling(image.Width * scale), h = (int)Math.Ceiling(image.Height * scale);
            return new Rectangle(box.X + (box.Width - w) / 2, box.Y + (box.Height - h) / 2, w, h);
        }

        private static GraphicsPath Rounded(Rectangle r, int radius)
        {
            var path = new GraphicsPath(); var d = radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && thumbnail != null) thumbnail.Dispose();
            base.Dispose(disposing);
        }
    }
}
