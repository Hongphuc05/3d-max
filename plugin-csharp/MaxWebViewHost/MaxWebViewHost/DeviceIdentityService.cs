using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class DeviceIdentityException : Exception
    {
        public string Code { get; private set; }
        public DeviceIdentityException(string code, string message) : base(message) { Code = code; }
    }

    internal sealed class PublicDeviceKey
    {
        public string kty { get; set; }
        public string n { get; set; }
        public string e { get; set; }
    }

    internal sealed class PublicDeviceIdentity
    {
        public string deviceId { get; set; }
        public PublicDeviceKey publicKey { get; set; }
        public string keyProtection { get; set; }
        public string deviceName { get; set; }
    }

    /// <summary>What DeviceSessionService needs from the device identity (the real one is DeviceIdentityService).</summary>
    internal interface IDeviceSigner
    {
        PublicDeviceIdentity GetIdentity();
        string SignChallenge(string challengeId, string message);
    }

    internal sealed class IdentityMetadata
    {
        public int Version { get; set; }
        public string DeviceId { get; set; }
        public string Protection { get; set; }
        public string PublicKeyHash { get; set; }
    }

    /// <summary>
    /// A Windows-user scoped identity, independent of the installed plugin directory.
    /// The CNG private key is never exported; DPAPI protects the UUID and key binding.
    /// Losing either half fails closed. This class deliberately provides no reset API.
    /// TPM protects key material, but no remote TPM attestation is claimed in V1.
    /// </summary>
    internal sealed class DeviceIdentityService : IDeviceSigner
    {
        private const string ProductionKeyName = "3DsMood.DeviceIdentity.v1";
        private static readonly CngProvider TpmProvider = new CngProvider("Microsoft Platform Crypto Provider");
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("3DsMood.DeviceIdentity.DPAPI.v1");
        private static readonly Regex NoncePattern = new Regex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant);
        private static readonly Regex HashPattern = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
        private readonly string directory;
        private readonly string keyName;
        private readonly bool preferTpm;
        private readonly string legacyDirectory;

        public DeviceIdentityService() : this(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MaxWebViewHost", "DeviceIdentity", "v1"), ProductionKeyName, true,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3DsMood", "DeviceIdentity", "v1")) { }

        // Only the standalone test harness supplies another directory/key name.
        internal DeviceIdentityService(string directory, string keyName, bool preferTpm)
            : this(directory, keyName, preferTpm, null) { }

        internal DeviceIdentityService(string directory, string keyName, bool preferTpm, string legacyDirectory)
        {
            this.directory = directory;
            this.keyName = keyName;
            this.preferTpm = preferTpm;
            this.legacyDirectory = legacyDirectory;
        }

        public PublicDeviceIdentity GetIdentity()
        {
            return WithIdentity((metadata, key) => new PublicDeviceIdentity
            {
                deviceId = metadata.DeviceId,
                publicKey = PublicKey(key),
                keyProtection = metadata.Protection,
                deviceName = SafeDeviceName()
            });
        }

        internal string PublicKeyHash()
        {
            return WithIdentity((metadata, key) => metadata.PublicKeyHash);
        }

        public string SignChallenge(string challengeId, string message)
        {
            return WithIdentity((metadata, key) =>
            {
                ValidateChallenge(challengeId, message, metadata);
                using (var rsa = new RSACng(key))
                    return Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(message),
                        HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            });
        }

        private T WithIdentity<T>(Func<IdentityMetadata, CngKey, T> action)
        {
            // Serializes separate Max processes belonging to this Windows user.
            var mutexName = "Local\\3DsMood.Identity." + Hex(Sha256(Encoding.UTF8.GetBytes(keyName)));
            using (var mutex = new Mutex(false, mutexName))
            {
                var acquired = false;
                try
                {
                    try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(20)); }
                    catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) throw Unavailable();
                    var metadata = ReadOrCreate();
                    using (var key = OpenExisting(metadata))
                    {
                        ValidateBinding(metadata, key);
                        return action(metadata, key);
                    }
                }
                catch (DeviceIdentityException) { throw; }
                catch (CryptographicException) { throw Unavailable(); }
                catch (UnauthorizedAccessException) { throw Unavailable(); }
                catch (IOException) { throw Unavailable(); }
                finally { if (acquired) mutex.ReleaseMutex(); }
            }
        }

        private IdentityMetadata ReadOrCreate()
        {
            var path = Path.Combine(directory, "identity.dat");
            if (File.Exists(path)) return ReadMetadata(path);
            if (!string.IsNullOrEmpty(legacyDirectory))
            {
                var legacyPath = Path.Combine(legacyDirectory, "identity.dat");
                if (File.Exists(legacyPath))
                {
                    // Moving protected metadata does not create a new identity or claim a slot.
                    // Both DPAPI and the existing non-exportable key must validate before writing.
                    var previous = ReadMetadata(legacyPath);
                    using (var previousKey = OpenExisting(previous)) ValidateBinding(previous, previousKey);
                    CreatePrivateDirectory();
                    WriteMetadataAtomically(path, previous);
                    return previous;
                }
            }
            // Do not generate a fresh UUID against an already existing private key.
            if (Exists(TpmProvider) || Exists(CngProvider.MicrosoftSoftwareKeyStorageProvider)) throw Lost();
            CreatePrivateDirectory();
            var protection = "SOFTWARE";
            CngKey key = null;
            if (preferTpm)
            {
                try { key = CreateKey(TpmProvider); protection = "TPM"; }
                catch (CryptographicException) { /* Explicit SOFTWARE result is surfaced to the UI. */ }
            }
            if (key == null) key = CreateKey(CngProvider.MicrosoftSoftwareKeyStorageProvider);
            using (key)
            {
                var metadata = new IdentityMetadata
                {
                    Version = 1, DeviceId = Guid.NewGuid().ToString("D"),
                    Protection = protection, PublicKeyHash = KeyHash(key)
                };
                WriteMetadataAtomically(path, metadata);
                return metadata;
            }
        }

        private static void ValidateBinding(IdentityMetadata metadata, CngKey key)
        {
            if (KeyHash(key) != metadata.PublicKeyHash || key.ExportPolicy != CngExportPolicies.None) throw Lost();
        }

        private static void WriteMetadataAtomically(string path, IdentityMetadata metadata)
        {
            var clear = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(metadata));
            byte[] encrypted;
            try { encrypted = ProtectedData.Protect(clear, Entropy, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(clear, 0, clear.Length); }
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                    4096, FileOptions.WriteThrough))
                {
                    stream.Write(encrypted, 0, encrypted.Length);
                    stream.Flush(true);
                }
                // Rename in the same private directory is atomic. File.Move never replaces
                // an existing identity, including an invalid or concurrently created one.
                File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private IdentityMetadata ReadMetadata(string path)
        {
            byte[] clear = null;
            try
            {
                if (new FileInfo(path).Length > 8192) throw Lost();
                clear = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser);
                var metadata = new JavaScriptSerializer().Deserialize<IdentityMetadata>(Encoding.UTF8.GetString(clear));
                Guid id;
                if (metadata == null || metadata.Version != 1 || !CanonicalUuid(metadata.DeviceId, out id)
                    || (metadata.Protection != "TPM" && metadata.Protection != "SOFTWARE")
                    || metadata.PublicKeyHash == null || !HashPattern.IsMatch(metadata.PublicKeyHash)) throw Lost();
                return metadata;
            }
            catch (Exception e)
            {
                if (e is OutOfMemoryException || e is StackOverflowException) throw;
                throw Lost();
            }
            finally { if (clear != null) Array.Clear(clear, 0, clear.Length); }
        }

        private void CreatePrivateDirectory()
        {
            if (Directory.Exists(directory)) return;
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,
                FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(directory, security);
        }

        private bool Exists(CngProvider provider)
        {
            try { return CngKey.Exists(keyName, provider); }
            catch (CryptographicException) { return false; }
        }

        private CngKey CreateKey(CngProvider provider)
        {
            var options = new CngKeyCreationParameters
            {
                Provider = provider, ExportPolicy = CngExportPolicies.None,
                KeyUsage = CngKeyUsages.Signing, KeyCreationOptions = CngKeyCreationOptions.None
            };
            options.Parameters.Add(new CngProperty("Length", BitConverter.GetBytes(2048), CngPropertyOptions.None));
            return CngKey.Create(CngAlgorithm.Rsa, keyName, options);
        }

        private CngKey OpenExisting(IdentityMetadata metadata)
        {
            var provider = metadata.Protection == "TPM" ? TpmProvider : CngProvider.MicrosoftSoftwareKeyStorageProvider;
            try { return CngKey.Open(keyName, provider); }
            catch (CryptographicException) { throw Lost(); }
        }

        private static void ValidateChallenge(string challengeId, string message, IdentityMetadata metadata)
        {
            var parts = message == null || message.Length > 512 ? new string[0] : message.Split('|');
            Guid ignored;
            // v3 server: 3DM-DEVICE-V2|challengeId|nonce|deviceUuid|publicKeyHashHex (no account, no activation slot).
            if (parts.Length == 5 && parts[0] == "3DM-DEVICE-V2")
            {
                if (!CanonicalUuid(challengeId, out ignored) || parts[1] != challengeId || !NoncePattern.IsMatch(parts[2])
                    || parts[3] != metadata.DeviceId || parts[4] != metadata.PublicKeyHash)
                    throw new DeviceIdentityException("INVALID_PARAMS", "Challenge thiết bị không hợp lệ.");
                return;
            }
            if (parts.Length != 7 || parts[0] != "3DM-DEVICE-V1"
                || !CanonicalUuid(challengeId, out ignored) || parts[1] != challengeId
                || !NoncePattern.IsMatch(parts[2]) || !CanonicalUuid(parts[3], out ignored)
                || parts[4] != metadata.DeviceId || (parts[5] != "ACTIVATE" && parts[5] != "VERIFY")
                || parts[6] != metadata.PublicKeyHash)
                throw new DeviceIdentityException("INVALID_PARAMS", "Challenge thiết bị không hợp lệ.");
        }

        private static bool CanonicalUuid(string value, out Guid id)
        {
            return Guid.TryParseExact(value, "D", out id) && id != Guid.Empty && id.ToString("D") == value;
        }

        private static PublicDeviceKey PublicKey(CngKey key)
        {
            using (var rsa = new RSACng(key))
            {
                var parameters = rsa.ExportParameters(false);
                return new PublicDeviceKey { kty = "RSA", n = Base64Url(parameters.Modulus), e = Base64Url(parameters.Exponent) };
            }
        }

        private static string KeyHash(CngKey key)
        {
            using (var rsa = new RSACng(key))
            {
                var p = rsa.ExportParameters(false);
                // .NET Framework 4.8 has no ExportSubjectPublicKeyInfo; emit canonical RSA SPKI DER.
                var rsaKey = Der(0x30, Join(DerInteger(p.Modulus), DerInteger(p.Exponent)));
                var algorithm = new byte[] { 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00 };
                return Hex(Sha256(Der(0x30, Join(algorithm, Der(0x03, Join(new byte[] { 0 }, rsaKey))))));
            }
        }

        private static byte[] DerInteger(byte[] value)
        {
            return Der(0x02, (value[0] & 0x80) != 0 ? Join(new byte[] { 0 }, value) : value);
        }
        private static byte[] Der(byte tag, byte[] value)
        {
            var bytes = new List<byte> { tag };
            if (value.Length < 128) bytes.Add((byte)value.Length);
            else if (value.Length <= 255) bytes.AddRange(new byte[] { 0x81, (byte)value.Length });
            else bytes.AddRange(new byte[] { 0x82, (byte)(value.Length >> 8), (byte)value.Length });
            bytes.AddRange(value);
            return bytes.ToArray();
        }
        private static byte[] Join(byte[] left, byte[] right) { return left.Concat(right).ToArray(); }
        private static byte[] Sha256(byte[] value) { using (var hash = SHA256.Create()) return hash.ComputeHash(value); }
        private static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
        private static string Base64Url(byte[] value) { return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
        private static string SafeDeviceName()
        {
            var name = new string(Environment.MachineName.Where(c => !char.IsControl(c)).Take(80).ToArray());
            return string.IsNullOrWhiteSpace(name) ? "Windows PC" : name;
        }
        private static DeviceIdentityException Lost()
        {
            return new DeviceIdentityException("DEVICE_IDENTITY_LOST", "Danh tính thiết bị đã mất hoặc bị thay đổi. Slot đã kích hoạt không được tự reset.");
        }
        private static DeviceIdentityException Unavailable()
        {
            return new DeviceIdentityException("DEVICE_IDENTITY_UNAVAILABLE", "Không truy cập được khóa thiết bị an toàn trên Windows.");
        }
    }
}
