using System;
using MaxWebViewHost;

internal static class ImportTargetSelectionTests
{
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception("FAILED: " + message);
        Console.WriteLine("PASS " + message);
    }

    private static void Main()
    {
        var first = new ImportTarget(101, 1001, "Living.max - Autodesk 3ds Max 2022", @"D:\Scenes\Living.max", new string('a', 32));
        var second = new ImportTarget(202, 2002, "Kitchen.max - Autodesk 3ds Max 2022", @"D:\Scenes\Kitchen.max", new string('b', 32));
        var selection = new ImportTargetSelection();
        selection.Refresh(new[] { first, second });
        Assert(selection.Current == null, "multiple scenes require an explicit client choice");
        Assert(selection.Select(second), "client can choose the second scene");
        selection.Refresh(new[] { second, first });
        Assert(selection.Current.ProcessId == 202, "enumeration order never changes the selected scene");
        selection.Refresh(new[] { first });
        Assert(selection.Current == null && selection.SelectedUnavailable, "closed target never falls back to another scene");
        selection.Refresh(new[] { first, new ImportTarget(202, 9999, second.SceneTitle, second.ScenePath, second.DocumentToken) });
        Assert(selection.Current == null, "a reused process id does not inherit target selection");
        Assert(selection.Select(first), "client can explicitly recover by selecting another scene");
        var snapshot = selection.Current;
        var renamed = new ImportTarget(101, 1001, "Bedroom.max - Autodesk 3ds Max 2022", @"D:\Scenes\Bedroom.max", new string('c', 32));
        selection.Refresh(new[] { renamed });
        Assert(selection.Current == null, "opening a different file requires a new explicit scene choice");
        Assert(!snapshot.IsSameScene(renamed), "changing the open file invalidates an in-flight import target");
        Assert(snapshot.IsSameScene(new ImportTarget(101, 1001, first.SceneTitle, first.ScenePath, first.DocumentToken)), "unchanged file and process validate");
        Assert(!snapshot.IsSameScene(new ImportTarget(101, 1001, first.SceneTitle, @"E:\Other\Living.max", new string('d', 32))), "same filename in another folder is a different selected scene");
        Assert(!snapshot.IsSameScene(new ImportTarget(101, 1001, first.SceneTitle, first.ScenePath, new string('e', 32))), "reopening the same path invalidates the old document generation");
        var untitled = new ImportTarget(101, 1001, "Untitled - Autodesk 3ds Max 2022", "", new string('a', 32));
        Assert(!untitled.IsSameScene(new ImportTarget(101, 1001, untitled.SceneTitle, "", new string('b', 32))), "resetting Untitled invalidates the old document generation");

        var single = new ImportTargetSelection();
        single.Refresh(new[] { first });
        Assert(single.Current.ProcessId == 101, "a single Max scene is selected automatically");
        single.Refresh(new[] { first, second });
        Assert(single.Current == null, "opening another Max requires explicit choice instead of using implicit focus");
        Assert(!single.Select(new ImportTarget(999, 999, "unknown")), "unlisted target cannot be selected");
        single.Select(first);
        Assert(!single.Select(null) && single.Current == null, "choosing the placeholder clears a previous valid target");
        single.Select(first);
        Assert(!single.Select(new ImportTarget(999, 999, "unknown")) && single.Current == null, "an invalid selection clears a previous valid target");
        var explicitSingle = new ImportTargetSelection();
        explicitSingle.Refresh(new[] { first });
        explicitSingle.Select(first);
        explicitSingle.Refresh(new[] { first, second });
        Assert(explicitSingle.Current.ProcessId == 101, "explicit client choice remains stable when another Max opens");
        var unavailable = new ImportTargetSelection();
        var missingAgent = new ImportTarget(303, 3003, first.SceneTitle);
        unavailable.Refresh(new[] { missingAgent });
        Assert(unavailable.Current == null && !unavailable.Select(missingAgent), "a process without adapter document identity cannot be selected or auto-selected");
    }
}
