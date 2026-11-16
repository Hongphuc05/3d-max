// The drop overlay: accepts only the file being dragged, never covers the panel, and is a hit-testable but practically invisible window.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using MaxWebViewHost;

class DragDropOverlayTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }

    [STAThread]
    static void Main()
    {
        const string file = @"C:\Lib\Chair\chair_2020.max";
        Func<string, IDataObject> drop = p => p == null ? new DataObject() : new DataObject(DragDropOverlay.DragFormat, p);
        Check(DragDropOverlay.Accepts(drop(file), file), "the panel's own drag of the file is accepted");
        Check(DragDropOverlay.Accepts(drop(file.ToUpperInvariant()), file), "path comparison ignores case");
        Check(!DragDropOverlay.Accepts(drop(@"C:\Other\evil.max"), file), "a different file is rejected");
        Check(!DragDropOverlay.Accepts(drop(null), file) && !DragDropOverlay.Accepts(null, file), "no data / no data object is rejected");
        var fileDrop = new DataObject(); fileDrop.SetData(DataFormats.FileDrop, new[] { file });
        Check(!DragDropOverlay.Accepts(fileDrop, file), "a plain file drop (e.g. from Explorer) of the same file is not ours: rejected");
        Check(!DragDropOverlay.Accepts(new DataObject(DataFormats.Text, "x"), file), "plain text is rejected");

        var max = new Rectangle(100, 100, 1000, 700);
        var panel = new Rectangle(300, 200, 400, 300);
        using (var overlay = new DragDropOverlay(max, panel, file))
        {
            Check(overlay.AllowDrop && overlay.TopMost && !overlay.ShowInTaskbar && overlay.Bounds == max, "overlay sits exactly over the Max window, topmost, not in the taskbar");
            Check(overlay.Opacity > 0 && overlay.Opacity < 0.05, "practically invisible but still hit-testable (alpha > 0)");
            Check(overlay.Region.IsVisible(new Point(10, 10)), "a point on Max outside the panel receives the drop");
            Check(!overlay.Region.IsVisible(new Point(300 - 100 + 50, 200 - 100 + 50)), "the panel's rectangle is cut out of the overlay");
            Check(!overlay.Dropped, "nothing is dropped yet");
        }
        using (var overlay = new DragDropOverlay(max, new Rectangle(5000, 5000, 10, 10), file))
            Check(overlay.Region.IsVisible(new Point(500, 300)), "a panel outside the Max window changes nothing");
        using (var overlay = new DragDropOverlay(max, null, file))
            Check(overlay.Region.IsVisible(new Point(500, 300)), "no panel (minimized/hidden): the whole Max window receives the drop");
        Check(DragDropOverlay.WindowBounds(IntPtr.Zero) == null, "no window handle: no bounds");

        // Panel collapse while dragging out of it, and what happens when the drag ends.
        Check(!DragDropOverlay.ShouldCollapse(panel, new Point(350, 250), false), "pointer still inside the panel: keep it open");
        Check(DragDropOverlay.ShouldCollapse(panel, new Point(900, 250), false), "pointer left the panel: minimize it");
        Check(!DragDropOverlay.ShouldCollapse(panel, new Point(900, 250), true), "minimize only once per drag");
        Check(!DragDropOverlay.ShouldCollapse(null, new Point(900, 250), false), "an already minimized/hidden panel is left alone");
        Check(DragDropOverlay.RestoreAfterDrag(DragDropEffects.None), "drag cancelled (Esc / released over nothing): bring the panel back");
        Check(!DragDropOverlay.RestoreAfterDrag(DragDropEffects.Copy), "dropped somewhere: keep the panel minimized");
        using (var overlay = new DragDropOverlay(max, panel, file))
        {
            overlay.CoverWholeWindow();
            Check(overlay.Region.IsVisible(new Point(300 - 100 + 50, 200 - 100 + 50)), "after the panel minimizes, its old area also receives the drop");
        }
        // Which window of each Max gets an overlay: not the 3dsmood panel (WinForms), not owned/hidden/minimized windows, the largest per Max.
        Func<int, string, Rectangle, bool, bool, bool, DragDropOverlay.MaxWindow> w = (pid, cls, r, visible, owned, minimized) =>
            new DragDropOverlay.MaxWindow { ProcessId = pid, ClassName = cls, Bounds = r, Visible = visible, Owned = owned, Minimized = minimized };
        var windows = new List<DragDropOverlay.MaxWindow> {
            w(10, "WindowsForms10.Window.8.app.0.1234_r6_ad1", new Rectangle(0, 0, 1100, 800), true, false, false),   // panel of Max 10, in front
            w(10, "Qt5QWindowIcon", new Rectangle(-1928, -3, 1936, 1048), true, false, false),                        // Max 10 main window
            w(10, "Qt5QWindowIcon", new Rectangle(10, 10, 300, 200), true, true, false),                               // owned dialog
            w(10, "Qt5QWindowIcon", new Rectangle(10, 10, 3000, 2000), false, false, false),                           // hidden
            w(20, "Qt5QWindowIcon", new Rectangle(1920, 0, 1920, 1040), true, false, false),                           // another Max
            w(30, "Qt5QWindowIcon", new Rectangle(0, 0, 1920, 1040), true, false, true),                               // minimized Max
            w(99, "Notepad", new Rectangle(0, 0, 5000, 5000), true, false, false) };                                  // not a Max
        var picked = DragDropOverlay.PickMaxWindows(windows, new HashSet<int> { 10, 20, 30 });
        Check(picked.Count == 2, "one window per visible Max; minimized Max and other apps are skipped");
        Check(picked.Exists(x => x.ProcessId == 10 && x.Bounds.X == -1928), "the panel (WinForms) is never taken as the Max window, even when it is in front");
        Check(picked.Exists(x => x.ProcessId == 20), "another Max is covered too");
        using (var other = new DragDropOverlay(max, null, file, 20, false))
            Check(!other.IsOwnerMax && other.ProcessId == 20, "an overlay knows whether it covers the Max hosting the panel");
        Console.WriteLine("All DragDropOverlay tests passed.");
    }
}
