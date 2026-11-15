// The panel gets its own AppUserModelID (separate taskbar button, icon M) without touching other windows.
using System;
using System.Windows.Forms;
using MaxWebViewHost;

class TaskbarIdentityTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }

    [STAThread]
    static void Main()
    {
        Check(TaskbarIdentity.PanelId == "3dsmood.Panel", "all panels share one fixed id (one grouped taskbar button)");
        using (var form = new Form())
        using (var other = new Form())
        {
            var handle = form.Handle; var otherHandle = other.Handle;   // forces handle creation without showing
            Check(TaskbarIdentity.Read(handle) == null, "a new window has no explicit AppUserModelID");
            Check(TaskbarIdentity.Apply(handle, TaskbarIdentity.PanelId), "Apply succeeds on a real window");
            Check(TaskbarIdentity.Read(handle) == "3dsmood.Panel", "the id reads back from the window");
            Check(TaskbarIdentity.Read(otherHandle) == null, "another window in the same process is not touched");
            Check(TaskbarIdentity.Apply(handle, "3dsmood.Other") && TaskbarIdentity.Read(handle) == "3dsmood.Other", "the id can be replaced (Apply really writes)");
        }
        Check(!TaskbarIdentity.Apply(IntPtr.Zero, TaskbarIdentity.PanelId), "no window handle: false, no exception");
        Check(!TaskbarIdentity.Apply(new IntPtr(0x7FFFFFF1), TaskbarIdentity.PanelId), "invalid handle: false, no exception");
        Check(TaskbarIdentity.Read(IntPtr.Zero) == null, "Read with no handle is null");
        Console.WriteLine("All TaskbarIdentity tests passed.");
    }
}
