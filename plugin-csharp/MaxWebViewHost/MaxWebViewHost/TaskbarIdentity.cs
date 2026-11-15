using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace MaxWebViewHost
{
    /// <summary>Gives ONE window its own AppUserModelID so the taskbar shows it as a separate button with the window's own icon, instead of
    /// grouping it under 3dsmax.exe (the plugin runs inside the Max process). Never touches the process-wide ID or any Max window.</summary>
    internal static class TaskbarIdentity
    {
        internal const string PanelId = "3dsmood.Panel";   // same for every Max: all panels share one taskbar button
        private const ushort VtLpwstr = 31;
        private static Guid IPropertyStoreId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PropertyKey { public Guid Format; public uint Id; }

        // Only the LPWSTR case of PROPVARIANT is used; Size covers the x64 layout (24 bytes).
        [StructLayout(LayoutKind.Explicit, Size = 24)]
        private struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Text; }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore
        {
            [PreserveSig] int GetCount(out uint count);
            [PreserveSig] int GetAt(uint index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
            [PreserveSig] int Commit();
        }

        [DllImport("shell32.dll")]
        private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant value);

        // System.AppUserModel.ID
        private static PropertyKey IdKey { get { return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 }; } }

        /// <summary>True when the ID was set. Any COM/OS failure returns false and leaves the window as it was (it just stays grouped with Max).</summary>
        internal static bool Apply(IntPtr hwnd, string id)
        {
            IPropertyStore store = null;
            var text = IntPtr.Zero;
            try
            {
                if (hwnd == IntPtr.Zero || string.IsNullOrEmpty(id)) return false;
                if (SHGetPropertyStoreForWindow(hwnd, ref IPropertyStoreId, out store) != 0 || store == null) return false;
                text = Marshal.StringToCoTaskMemUni(id);
                var value = new PropVariant { Type = VtLpwstr, Text = text };
                var key = IdKey;
                var ok = store.SetValue(ref key, ref value) == 0 && store.Commit() == 0;
                return ok;
            }
            catch (Exception e) when (e is COMException || e is EntryPointNotFoundException || e is DllNotFoundException || e is InvalidCastException)
            {
                Debug.WriteLine("[taskbar] " + e.GetType().Name);
                return false;
            }
            finally
            {
                if (text != IntPtr.Zero) Marshal.FreeCoTaskMem(text);   // the store keeps its own copy
                if (store != null) Marshal.ReleaseComObject(store);
            }
        }

        /// <summary>The window's current AppUserModelID, or null (used by tests and diagnostics).</summary>
        internal static string Read(IntPtr hwnd)
        {
            IPropertyStore store = null;
            var value = new PropVariant();
            try
            {
                if (hwnd == IntPtr.Zero || SHGetPropertyStoreForWindow(hwnd, ref IPropertyStoreId, out store) != 0 || store == null) return null;
                var key = IdKey;
                if (store.GetValue(ref key, out value) != 0 || value.Type != VtLpwstr) return null;
                return Marshal.PtrToStringUni(value.Text);
            }
            catch (Exception e) when (e is COMException || e is EntryPointNotFoundException || e is DllNotFoundException || e is InvalidCastException) { return null; }
            finally
            {
                if (value.Type != 0) PropVariantClear(ref value);
                if (store != null) Marshal.ReleaseComObject(store);
            }
        }
    }
}
