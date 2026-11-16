using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace MaxWebViewHost
{
    /// <summary>Near-invisible window laid over a 3ds Max window ONLY while a model is being dragged out of the panel. It receives the drop instead
    /// of Max, so the plugin shows its own menu (Max's built-in menu cannot be changed: its Open File always replaces the current scene). One overlay
    /// per open Max; the panel's own rectangle is cut out so dropping back on the panel is not captured.</summary>
    internal sealed class DragDropOverlay : Form
    {
        /// <summary>Private clipboard format carried by the drag. Not a file drop on purpose: Explorer/Desktop and Max's own drop handler ignore it,
        /// so the only places that accept the drag are these overlays (no stray file copies, never Max's replace-the-scene Open).</summary>
        internal const string DragFormat = "3dsmood.dragged-model";
        private readonly string expectedPath;
        internal bool Dropped { get; private set; }
        internal Point DropPoint { get; private set; }
        internal int ProcessId { get; private set; }
        /// <summary>True for the Max that hosts this panel (full menu); other Max windows only offer Open in a new Max.</summary>
        internal bool IsOwnerMax { get; private set; }

        internal struct MaxWindow
        {
            public int ProcessId; public IntPtr Handle; public string ClassName; public Rectangle Bounds; public bool Visible, Owned, Minimized;
        }

        [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
        private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);

        /// <param name="bounds">Screen rectangle of the Max window.</param>
        /// <param name="hole">Screen rectangle that must NOT receive the drop (the panel), or null.</param>
        internal DragDropOverlay(Rectangle bounds, Rectangle? hole, string expectedPath, int processId = 0, bool ownerMax = true)
        {
            this.expectedPath = expectedPath;
            ProcessId = processId;
            IsOwnerMax = ownerMax;
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

        /// <summary>After the panel has been minimized mid-drag nothing of it covers Max any more: drop the cut-out.</summary>
        internal void CoverWholeWindow() { Region = new Region(new Rectangle(Point.Empty, Size)); }

        /// <summary>Minimize the panel once, the first time the pointer leaves its (visible) rectangle during a drag.</summary>
        internal static bool ShouldCollapse(Rectangle? panel, Point cursor, bool alreadyCollapsed)
        {
            return !alreadyCollapsed && panel.HasValue && !panel.Value.Contains(cursor);
        }

        /// <summary>Bring the panel back only when the drag ended without a drop (Esc, released over nothing that accepts it).</summary>
        internal static bool RestoreAfterDrag(DragDropEffects effect) { return effect == DragDropEffects.None; }

        /// <summary>True only for the plugin's own drag of exactly the file the panel started dragging.</summary>
        internal static bool Accepts(IDataObject data, string expectedPath)
        {
            try
            {
                if (data == null || !data.GetDataPresent(DragFormat, false)) return false;
                return string.Equals(data.GetData(DragFormat, false) as string, expectedPath, StringComparison.OrdinalIgnoreCase);
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

        /// <summary>The main window of each 3ds Max: visible, not minimized, top-level and unowned, not a WinForms window (the 3dsmood panel of that
        /// Max is a WinForms window, which is what Process.MainWindowHandle wrongly returned when the panel was in front), largest such window per process.</summary>
        internal static List<MaxWindow> PickMaxWindows(IEnumerable<MaxWindow> windows, ICollection<int> maxProcessIds)
        {
            return windows
                .Where(w => w.Visible && !w.Owned && !w.Minimized && maxProcessIds.Contains(w.ProcessId) && w.Bounds.Width > 0 && w.Bounds.Height > 0
                    && !(w.ClassName ?? "").StartsWith("WindowsForms10.", StringComparison.Ordinal))
                .GroupBy(w => w.ProcessId)
                .Select(g => g.OrderByDescending(w => (long)w.Bounds.Width * w.Bounds.Height).First())
                .ToList();
        }

        /// <summary>Main windows of every running 3dsmax.exe on this desktop.</summary>
        internal static List<MaxWindow> FindMaxWindows()
        {
            var pids = new HashSet<int>();
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("3dsmax")) using (p) pids.Add(p.Id);
            var all = new List<MaxWindow>();
            if (pids.Count == 0) return all;
            EnumWindows((hwnd, l) =>
            {
                uint pid; GetWindowThreadProcessId(hwnd, out pid);
                if (!pids.Contains((int)pid)) return true;
                var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
                Rect r; GetWindowRect(hwnd, out r);
                all.Add(new MaxWindow { ProcessId = (int)pid, Handle = hwnd, ClassName = name.ToString(), Bounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom),
                    Visible = IsWindowVisible(hwnd), Owned = GetWindow(hwnd, 4) != IntPtr.Zero, Minimized = IsIconic(hwnd) });   // 4 = GW_OWNER
                return true;
            }, IntPtr.Zero);
            return PickMaxWindows(all, pids);
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
