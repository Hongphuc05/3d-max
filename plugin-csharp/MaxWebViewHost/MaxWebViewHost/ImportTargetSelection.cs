using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace MaxWebViewHost
{
    internal sealed class ImportTarget
    {
        public int ProcessId { get; private set; }
        public long StartedTicks { get; private set; }
        public string SceneTitle { get; private set; }
        public string ScenePath { get; private set; }
        public string DocumentToken { get; private set; }
        public bool IsReady { get { return !string.IsNullOrEmpty(DocumentToken); } }
        public string DisplayName
        {
            get
            {
                var scene = !string.IsNullOrEmpty(ScenePath) ? System.IO.Path.GetFileNameWithoutExtension(ScenePath)
                    : IsReady ? "Untitled" : SceneTitle.Replace(" - Autodesk ", " | ");
                return scene + (scene.IndexOf("3ds Max", StringComparison.OrdinalIgnoreCase) >= 0 ? "" : " | 3ds Max 2022");
            }
        }
        public ImportTarget(int processId, long startedTicks, string sceneTitle)
            : this(processId, startedTicks, sceneTitle, null, null) { }
        public ImportTarget(int processId, long startedTicks, string sceneTitle, string scenePath, string documentToken)
        { ProcessId = processId; StartedTicks = startedTicks; SceneTitle = sceneTitle; ScenePath = scenePath; DocumentToken = documentToken; }
        public bool IsSameProcess(ImportTarget other)
        { return other != null && ProcessId == other.ProcessId && StartedTicks == other.StartedTicks; }
        public bool IsSameScene(ImportTarget other)
        { return IsSameProcess(other) && IsReady && other.IsReady && string.Equals(DocumentToken, other.DocumentToken, StringComparison.Ordinal)
            && string.Equals(ScenePath, other.ScenePath, StringComparison.OrdinalIgnoreCase); }
        public override string ToString()
        {
            var name = string.IsNullOrEmpty(ScenePath) ? SceneTitle : System.IO.Path.GetFileName(ScenePath);
            return name + "  ·  PID " + ProcessId + (string.IsNullOrEmpty(ScenePath) ? "" : "  ·  " + ScenePath)
                + (IsReady ? "" : " · agent chưa sẵn sàng");
        }
    }

    // Keep the client choice stable; focus changes and process enumeration order are not consent.
    internal sealed class ImportTargetSelection
    {
        private ImportTarget[] targets = new ImportTarget[0];
        private bool explicitSelection;
        private bool mayAutoSelect = true;
        public ImportTarget Selected { get; private set; }
        public ImportTarget[] Targets { get { return targets.ToArray(); } }
        public ImportTarget Current { get { return targets.FirstOrDefault(t => t.IsSameScene(Selected)); } }
        public bool SelectedUnavailable { get { return Selected != null && Current == null; } }
        public void Refresh(IEnumerable<ImportTarget> available)
        {
            targets = available.OrderBy(t => t.SceneTitle, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.ProcessId).ToArray();
            if (!explicitSelection && targets.Length > 1) Selected = null;
            if (Selected == null && mayAutoSelect && targets.Length == 1 && targets[0].IsReady)
            { Selected = targets[0]; mayAutoSelect = false; }
            var current = Current;
            if (current != null) Selected = current;
        }
        public bool Select(ImportTarget target)
        {
            var current = targets.FirstOrDefault(t => t.IsSameScene(target));
            if (current == null) { Selected = null; explicitSelection = true; mayAutoSelect = false; return false; }
            Selected = current; explicitSelection = true; mayAutoSelect = false;
            return true;
        }
    }

    internal static class ImportTargetDiscovery
    {
        private delegate bool EnumWindow(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);

        public static bool Focus(ImportTarget target)
        {
            if (target == null || !target.IsReady) return false;
            try
            {
                using (var process = Process.GetProcessById(target.ProcessId))
                    if (process.HasExited || process.StartTime.ToUniversalTime().Ticks != target.StartedTicks
                        || !string.Equals(process.ProcessName, "3dsmax", StringComparison.OrdinalIgnoreCase)) return false;
                var frame = IntPtr.Zero;
                EnumWindows((window, unused) =>
                {
                    uint pid; GetWindowThreadProcessId(window, out pid);
                    if (pid != target.ProcessId || !IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero) return true;
                    var title = new StringBuilder(1024);
                    GetWindowText(window, title, title.Capacity);
                    if (title.ToString().IndexOf("Autodesk 3ds Max", StringComparison.OrdinalIgnoreCase) < 0) return true;
                    frame = window;
                    return false;
                }, IntPtr.Zero);
                if (frame == IntPtr.Zero) return false;
                if (IsIconic(frame)) ShowWindowAsync(frame, 9); // SW_RESTORE, preserve maximized windows otherwise.
                return SetForegroundWindow(frame);
            }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
            catch (System.ComponentModel.Win32Exception) { return false; }
        }

        public static ImportTarget[] Discover()
        {
            var titles = new Dictionary<int, string>();
            EnumWindows((window, unused) =>
            {
                if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero) return true; // GW_OWNER: exclude dialogs.
                var text = new StringBuilder(1024);
                GetWindowText(window, text, text.Capacity);
                var title = text.ToString();
                // MainWindowTitle can point at our floating panel. Enumerate the actual Max scene frame.
                if (title.IndexOf("Autodesk 3ds Max", StringComparison.OrdinalIgnoreCase) < 0) return true;
                uint pid; GetWindowThreadProcessId(window, out pid);
                titles[(int)pid] = title;
                return true;
            }, IntPtr.Zero);
            var results = new List<ImportTarget>();
            foreach (var title in titles)
            {
                try
                {
                    using (var process = Process.GetProcessById(title.Key))
                        if (!process.HasExited && string.Equals(process.ProcessName, "3dsmax", StringComparison.OrdinalIgnoreCase))
                            results.Add(new ImportTarget(process.Id, process.StartTime.ToUniversalTime().Ticks, title.Value));
                }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }
            return results.ToArray();
        }
    }
}
