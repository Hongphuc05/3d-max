using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace MaxWebViewHost
{
    public sealed class OfflineLicenseStatus
    {
        public string machineCode { get; internal set; }
        public bool licensed { get; internal set; }
        public string message { get; internal set; }
    }

    /// <summary>Verifies an owner-signed permanent grant. No network, clock or account dependency.</summary>
    public sealed class OfflineLicenseService
    {
        private const int MaximumTokenLength = 16384;
        private readonly string publicKeyXml;
        private readonly string licensePath;
        private readonly object gate = new object();
        public string MachineCode { get; private set; }

        public OfflineLicenseService(string publicKeyXml, string storageDirectory)
            : this(publicKeyXml, storageDirectory, ReadMachineCode()) { }

        internal OfflineLicenseService(string publicKeyXml, string storageDirectory, string machineCode)
        {
            if (!Regex.IsMatch(machineCode ?? "", "\\AMAX-[A-F0-9]{64}\\z"))
                throw new InvalidDataException("Không đọc được mã máy. Liên hệ nhà cung cấp.");
            try
            {
                if (string.IsNullOrWhiteSpace(publicKeyXml) || publicKeyXml.Length > 8192)
                    throw new InvalidDataException("Bộ cài thiếu khóa xác minh license.");
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(publicKeyXml);
                    if (!rsa.PublicOnly || rsa.KeySize < 2048 || rsa.KeySize > 4096)
                        throw new InvalidDataException("Bộ cài phải chứa khóa công khai RSA 2048–4096 bit.");
                }
            }
            catch (CryptographicException) { throw new InvalidDataException("Khóa xác minh license không hợp lệ. Hãy cài lại plugin."); }
            catch (System.Xml.XmlException) { throw new InvalidDataException("Khóa xác minh license không hợp lệ. Hãy cài lại plugin."); }
            catch (System.Security.XmlSyntaxException) { throw new InvalidDataException("Khóa xác minh license không hợp lệ. Hãy cài lại plugin."); }
            this.publicKeyXml = publicKeyXml;
            licensePath = Path.Combine(Path.GetFullPath(storageDirectory), "license.txt");
            MachineCode = machineCode;
        }

        public OfflineLicenseStatus GetStatus()
        {
            lock (gate)
            {
                try { Validate(ReadSaved()); return Status(true, "License vĩnh viễn đã kích hoạt trên máy này."); }
                catch (Exception error) when (error is IOException || error is InvalidDataException || error is UnauthorizedAccessException)
                { return Status(false, error is InvalidDataException ? error.Message : "Chưa có license hợp lệ. Gửi mã máy cho nhà cung cấp để nhận license."); }
            }
        }

        public OfflineLicenseStatus Activate(string license)
        {
            lock (gate)
            {
                var token = (license ?? "").Trim();
                Validate(token);
                var directory = Path.GetDirectoryName(licensePath);
                Directory.CreateDirectory(directory);
                var temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
                try
                {
                    File.WriteAllText(temporary, token, new UTF8Encoding(false));
                    if (File.Exists(licensePath)) File.Replace(temporary, licensePath, null);
                    else File.Move(temporary, licensePath);
                }
                catch (Exception error) when (error is IOException || error is InvalidDataException || error is UnauthorizedAccessException)
                { throw new InvalidDataException("Không lưu được license. Kiểm tra quyền ghi thư mục dữ liệu của plugin.", error); }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
                return Status(true, "License vĩnh viễn đã kích hoạt trên máy này.");
            }
        }

        // Keep the first valid machine license intact, including when two activation requests arrive together.
        public OfflineLicenseStatus ActivateForOnline(string license)
        {
            lock (gate)
            {
                ValidateForOnline(license);
                return Activate(license);
            }
        }

        // Do not persist an unconfirmed key: the server can reject a valid signature or an existing binding.
        public void ValidateForOnline(string license)
        {
            lock (gate)
            {
                var token = (license ?? "").Trim();
                Validate(token);
                if (GetStatus().licensed && !string.Equals(ReadSaved(), token, StringComparison.Ordinal))
                    throw new InvalidDataException("Máy này đã có license. Liên hệ quản trị viên nếu cần hỗ trợ.");
            }
        }

        public void EnsureLicensed()
        {
            var status = GetStatus();
            if (!status.licensed) throw new InvalidDataException(status.message);
        }

        private OfflineLicenseStatus Status(bool licensed, string message)
        { return new OfflineLicenseStatus { machineCode = MachineCode, licensed = licensed, message = message }; }

        private string ReadSaved()
        {
            if (!File.Exists(licensePath)) throw new InvalidDataException("Chưa kích hoạt license. Gửi mã máy cho nhà cung cấp.");
            if (new FileInfo(licensePath).Length > MaximumTokenLength) throw InvalidLicense();
            return File.ReadAllText(licensePath).Trim();
        }

        private void Validate(string token)
        {
            if (string.IsNullOrEmpty(token) || token.Length > MaximumTokenLength) throw InvalidLicense();
            var pieces = token.Split('.');
            if (pieces.Length != 3 || pieces[0] != "MXL1") throw InvalidLicense();
            try
            {
                var payload = Decode(pieces[1]);
                var signature = Decode(pieces[2]);
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(publicKeyXml);
                    if (!rsa.VerifyData(payload, CryptoConfig.MapNameToOID("SHA256"), signature)) throw InvalidLicense();
                }
                var text = new UTF8Encoding(false, true).GetString(payload);
                var body = new JavaScriptSerializer { MaxJsonLength = MaximumTokenLength, RecursionLimit = 8 }
                    .Deserialize<Dictionary<string, object>>(text);
                if (body == null || body.Count != 4 || !body.ContainsKey("version") || !(body["version"] is int)
                    || (int)body["version"] != 1 || !body.ContainsKey("product") || !Equals(body["product"], "3dsmood-library")
                    || !body.ContainsKey("machineCode") || !(body["machineCode"] is string)
                    || !body.ContainsKey("licenseId") || !(body["licenseId"] is string)
                    || !Regex.IsMatch((string)body["licenseId"], "\\A[A-Za-z0-9_-]{1,80}\\z")) throw InvalidLicense();
                if (!string.Equals((string)body["machineCode"], MachineCode, StringComparison.Ordinal))
                    throw new InvalidDataException("License thuộc máy khác. Gửi mã máy hiện tại cho nhà cung cấp để cấp lại.");
            }
            catch (Exception error) when (error is FormatException || error is CryptographicException
                || error is ArgumentException || error is InvalidOperationException || error is DecoderFallbackException)
            { throw InvalidLicense(); }
        }

        private static byte[] Decode(string value)
        {
            if (!Regex.IsMatch(value, "\\A[A-Za-z0-9_-]+\\z")) throw InvalidLicense();
            var padded = value.Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(padded.PadRight((padded.Length + 3) / 4 * 4, '='));
            if (Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') != value) throw InvalidLicense();
            return bytes;
        }

        private static InvalidDataException InvalidLicense()
        { return new InvalidDataException("License không hợp lệ hoặc đã bị sửa. Hãy dán đầy đủ license do nhà cung cấp cấp."); }

        internal static string CreateMachineCode(string machineGuid)
        {
            Guid parsed;
            if (!Guid.TryParse(machineGuid, out parsed) || parsed == Guid.Empty)
                throw new InvalidDataException("Không đọc được định danh Windows để tạo mã máy.");
            using (var hash = SHA256.Create())
                return "MAX-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes("3dsmood-library-machine-v1:" + parsed.ToString("D")))).Replace("-", "");
        }

        internal static string ReadMachineCode()
        {
            try
            {
                using (var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var cryptography = machine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography", false))
                    return CreateMachineCode(cryptography == null ? null : cryptography.GetValue("MachineGuid") as string);
            }
            catch (Exception error) when (error is UnauthorizedAccessException || error is System.Security.SecurityException || error is IOException)
            { throw new InvalidDataException("Không đọc được mã máy Windows. Liên hệ nhà cung cấp.", error); }
        }
    }
}
