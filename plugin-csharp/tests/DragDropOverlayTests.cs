// The drop overlay: accepts only the file being dragged, never covers the panel, and is a hit-testable but practically invisible window.
using System;
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
        Func<string[], IDataObject> drop = files => { var d = new DataObject(); if (files != null) d.SetData(DataFormats.FileDrop, files); return d; };
        Check(DragDropOverlay.Accepts(drop(new[] { file }), file), "the dragged file is accepted");
        Check(DragDropOverlay.Accepts(drop(new[] { file.ToUpperInvariant() }), file), "path comparison ignores case");
        Check(!DragDropOverlay.Accepts(drop(new[] { @"C:\Other\evil.max" }), file), "a different file is rejected");
        Check(!DragDropOverlay.Accepts(drop(new[] { file, @"C:\Other\evil.max" }), file), "a multi-file drop is rejected");
        Check(!DragDropOverlay.Accepts(drop(null), file) && !DragDropOverlay.Accepts(null, file), "no file data / no data object is rejected");
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
        Console.WriteLine("All DragDropOverlay tests passed.");
    }
}
