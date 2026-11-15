using System;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MaxWebViewHost
{
    /// <summary>Near-invisible window laid over the working 3ds Max window ONLY while a model is being dragged out of the panel. It receives the drop
    /// instead of Max, so the plugin can show its own Open/Merge/XRef menu (Max's built-in menu cannot be changed: its Open File always replaces the
    /// current scene). The panel's own rectangle is cut out of it so dropping back on the panel is not captured.</summary>
    internal sealed class DragDropOverlay : Form
    {
        private readonly string expectedPath;
        internal bool Dropped { get; private set; }
        internal Point DropPoint { get; private set; }

        [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);

        /// <param name="bounds">Screen rectangle of the Max window.</param>
        /// <param name="hole">Screen rectangle that must NOT receive the drop (the panel), or null.</param>
        internal DragDropOverlay(Rectangle bounds, Rectangle? hole, string expectedPath)
        {
            this.expectedPath = expectedPath;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            TopMost = true;
            BackColor = Color.Black;
            Opacity = 0.01;   // alpha > 0 so it is hit-testable by the drag; practically invisible
            AllowDrop = true;
            var region = new Region(new Rectangle(0, 0, bounds.Width, bounds.Height));
            if (hole.HasValue)
            {
                var inner = Rectangle.Intersect(bounds, hole.Value);
                if (!inner.IsEmpty) region.Exclude(new Rectangle(inner.X - bounds.X, inner.Y - bounds.Y, inner.Width, inner.Height));
            }
            Region = region;
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000080; return cp; }   // WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
        }

        /// <summary>True only for a file drop of exactly the file the panel started dragging.</summary>
        internal static bool Accepts(IDataObject data, string expectedPath)
        {
            try
            {
                var files = data == null ? null : data.GetData(DataFormats.FileDrop) as string[];
                return files != null && files.Length == 1 && string.Equals(files[0], expectedPath, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception e) when (e is COMException || e is InvalidCastException || e is ExternalException) { return false; }
        }

        protected override void OnDragEnter(DragEventArgs e) { e.Effect = Accepts(e.Data, expectedPath) ? DragDropEffects.Copy : DragDropEffects.None; }
        protected override void OnDragOver(DragEventArgs e) { e.Effect = Accepts(e.Data, expectedPath) ? DragDropEffects.Copy : DragDropEffects.None; }
        protected override void OnDragDrop(DragEventArgs e)
        {
            if (!Accepts(e.Data, expectedPath)) { e.Effect = DragDropEffects.None; return; }
            Dropped = true;
            DropPoint = Cursor.Position;
            e.Effect = DragDropEffects.Copy;
        }

        /// <summary>Screen rectangle of a top-level window, or null when it is missing, minimized or hidden.</summary>
        internal static Rectangle? WindowBounds(IntPtr hwnd)
        {
            Rect r;
            if (hwnd == IntPtr.Zero || IsIconic(hwnd) || !IsWindowVisible(hwnd) || !GetWindowRect(hwnd, out r)) return null;
            var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
            return rect.Width > 0 && rect.Height > 0 ? (Rectangle?)rect : null;
        }
    }
}
