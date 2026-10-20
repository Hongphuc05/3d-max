using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

namespace Setup
{
    internal static class Program
    {
        private const string MaxUserRel = @"Autodesk\3dsMax\2022 - 64bit\ENU";
        private const string Title = "Platform for 3ds Max 2022";

        [STAThread]
        private static int Main()
        {
            try
            {
                var target = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), MaxUserRel);

                if (!Directory.Exists(target))
                    return Fail("Không thấy thư mục user của 3ds Max 2022:\n\n" + target +
                                "\n\nMở 3ds Max 2022 ít nhất một lần rồi chạy lại installer.");

                if (Process.GetProcessesByName("3dsmax").Length > 0)
                    return Fail("3ds Max đang chạy nên file DLL bị khoá.\n\nĐóng 3ds Max rồi chạy lại installer.");

                int n;
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Setup.payload.zip"))
                using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
                    n = Extract(zip, target);

                MessageBox.Show(
                    "Cài đặt xong — " + n + " file vào:\n" + target +
                    "\n\nMở 3ds Max 2022, rồi vào:\n" +
                    "Customize > Customize User Interface > tab Toolbars\n" +
                    "Category \"Platform\" > kéo OpenPlatformPanel vào một toolbar.",
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception ex)
            {
                return Fail("Cài đặt thất bại:\n\n" + ex.Message);
            }
        }

        /// <summary>Platform\... -> ENU\scripts\Platform\...,  usermacros\... -> ENU\usermacros\...</summary>
        private static int Extract(ZipArchive zip, string target)
        {
            var root = Path.GetFullPath(target) + Path.DirectorySeparatorChar;
            var count = 0;

            foreach (var e in zip.Entries)
            {
                if (string.IsNullOrEmpty(e.Name)) continue; // entry thư mục

                var rel = e.FullName.Replace('/', '\\');
                string dest;
                if (rel.StartsWith(@"Platform\", StringComparison.OrdinalIgnoreCase))
                    dest = Path.Combine(target, "scripts", rel);
                else if (rel.StartsWith(@"Startup\", StringComparison.OrdinalIgnoreCase))
                    dest = Path.Combine(target, "scripts", rel);
                else if (rel.StartsWith(@"usermacros\", StringComparison.OrdinalIgnoreCase))
                    dest = Path.Combine(target, rel);
                else
                    continue;

                // zip-slip: entry nào canonicalize ra ngoài target thì bỏ
                var full = Path.GetFullPath(dest);
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;

                Directory.CreateDirectory(Path.GetDirectoryName(full));
                e.ExtractToFile(full, true);
                count++;
            }
            return count;
        }

        private static int Fail(string message)
        {
            MessageBox.Show(message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
