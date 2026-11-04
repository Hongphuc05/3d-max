using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace MaxWebViewHost
{
    /// <summary>Stable per-machine code ("MAX-" + SHA-256 of the Windows MachineGuid) sent to the server when registering the device.</summary>
    internal static class MachineCode
    {
        internal static string Create(string machineGuid)
        {
            Guid parsed;
            if (!Guid.TryParse(machineGuid, out parsed) || parsed == Guid.Empty)
                throw new InvalidDataException("Không đọc được định danh Windows để tạo mã máy.");
            using (var hash = SHA256.Create())
                return "MAX-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes("3dsmood-library-machine-v1:" + parsed.ToString("D")))).Replace("-", "");
        }

        internal static string Read()
        {
            try
            {
                using (var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var cryptography = machine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography", false))
                    return Create(cryptography == null ? null : cryptography.GetValue("MachineGuid") as string);
            }
            catch (Exception error) when (error is UnauthorizedAccessException || error is System.Security.SecurityException || error is IOException)
            { throw new InvalidDataException("Không đọc được mã máy Windows. Liên hệ nhà cung cấp.", error); }
        }
    }
}
