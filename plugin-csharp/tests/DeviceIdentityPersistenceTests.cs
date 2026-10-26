using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using MaxWebViewHost;

internal static class DeviceIdentityPersistenceTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static int passed;

    private sealed class Snapshot
    {
        public string DeviceId { get; set; }
        public string KeyHash { get; set; }
        public string Protection { get; set; }
        public string Error { get; set; }
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 4 && args[0] == "child")
            {
                Snapshot result;
                try { result = ReadAndProve(new DeviceIdentityService(args[1], args[2], bool.Parse(args[3]))); }
                catch (DeviceIdentityException error) { result = new Snapshot { Error = error.Code }; }
                Console.WriteLine(Json.Serialize(result));
                return 0;
            }
            if (args.Length == 1 && args[0] == "--production-readonly")
            {
                var metadata = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "3DsMood", "DeviceIdentity", "v1", "identity.dat");
                if (!File.Exists(metadata)) throw new Exception("Existing production identity is required; no identity will be created.");
                // Use the existing location explicitly: the default constructor may perform
                // a legitimate migration, which is intentionally outside this readonly mode.
                var snapshot = ReadAndProve(new DeviceIdentityService(Path.GetDirectoryName(metadata),
                    "3DsMood.DeviceIdentity.v1", true));
                Console.WriteLine("PASS existing production identity opens and signs; provider=" + snapshot.Protection);
                return 0;
            }
            TestPersistedIdentity(false);
            TestPersistedIdentity(true);
            TestConcurrentFirstUse();
            TestMissingMetadataFailsClosed();
            TestMissingKeyFailsClosed();
            TestLegacyMigrationPreservesIdentity();
            TestLegacyMigrationRequiresOriginalKey();
            TestCanonicalCorruptionNeverFallsBack();
            Console.WriteLine("Device identity persistence tests passed: " + passed);
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static void TestPersistedIdentity(bool preferTpm)
    {
        WithFixture((directory, name) =>
        {
            var first = Child(directory, name, preferTpm);
            var second = Child(directory, name, preferTpm);
            var third = Child(directory, name, preferTpm);
            Assert(first.Error == null && second.Error == null && third.Error == null,
                "independent processes reopen identity and sign challenges (prefer TPM=" + preferTpm + ")");
            Assert(first.DeviceId == second.DeviceId && first.DeviceId == third.DeviceId
                && first.KeyHash == second.KeyHash && first.KeyHash == third.KeyHash
                && first.Protection == second.Protection && first.Protection == third.Protection,
                "device UUID, key and provider survive process exit (provider=" + first.Protection + ")");
            if (!preferTpm) Assert(first.Protection == "SOFTWARE", "explicit software fixture does not depend on TPM");
        });
    }

    private static void TestConcurrentFirstUse()
    {
        WithFixture((directory, name) =>
        {
            var tasks = Enumerable.Range(0, 4).Select(_ => Task.Run(() => Child(directory, name, false))).ToArray();
            Task.WaitAll(tasks);
            var snapshots = tasks.Select(task => task.Result).ToArray();
            Assert(snapshots.All(snapshot => snapshot.Error == null)
                && snapshots.Select(snapshot => snapshot.DeviceId).Distinct().Count() == 1
                && snapshots.Select(snapshot => snapshot.KeyHash).Distinct().Count() == 1,
                "concurrent Max processes establish one UUID/key pair without consuming another identity");
        });
    }

    private static void TestMissingMetadataFailsClosed()
    {
        WithFixture((directory, name) =>
        {
            Child(directory, name, false);
            File.Move(Path.Combine(directory, "identity.dat"), Path.Combine(directory, "identity.backup"));
            var snapshot = Child(directory, name, false);
            Assert(snapshot.Error == "DEVICE_IDENTITY_LOST" && !File.Exists(Path.Combine(directory, "identity.dat")),
                "a remaining private key never generates a replacement UUID when metadata is missing");
        });
    }

    private static void TestMissingKeyFailsClosed()
    {
        WithFixture((directory, name) =>
        {
            Child(directory, name, false);
            var before = File.ReadAllBytes(Path.Combine(directory, "identity.dat"));
            DeleteFixtureKeys(name);
            var snapshot = Child(directory, name, false);
            Assert(snapshot.Error == "DEVICE_IDENTITY_LOST"
                && before.SequenceEqual(File.ReadAllBytes(Path.Combine(directory, "identity.dat")))
                && !CngKey.Exists(name, CngProvider.MicrosoftSoftwareKeyStorageProvider),
                "lost private key does not replace existing metadata or create a new slot identity");
        });
    }

    private static void TestLegacyMigrationPreservesIdentity()
    {
        WithFixture((directory, name) =>
        {
            var legacy = Path.Combine(directory, "legacy");
            var canonical = Path.Combine(directory, "canonical");
            var before = Child(legacy, name, false);
            var oldBytes = File.ReadAllBytes(Path.Combine(legacy, "identity.dat"));
            var service = new DeviceIdentityService(canonical, name, false, legacy);
            var migrated = ReadAndProve(service);
            var reopened = Child(canonical, name, false);
            Assert(migrated.DeviceId == before.DeviceId && migrated.KeyHash == before.KeyHash
                && reopened.DeviceId == before.DeviceId && reopened.KeyHash == before.KeyHash
                && oldBytes.SequenceEqual(File.ReadAllBytes(Path.Combine(legacy, "identity.dat"))),
                "verified legacy migration preserves UUID/key and survives a new process without changing the source");
            var security = Directory.GetAccessControl(canonical);
            Assert(security.AreAccessRulesProtected,
                "migrated identity directory retains protected current-user access rules");
        });
    }

    private static void TestLegacyMigrationRequiresOriginalKey()
    {
        WithFixture((directory, name) =>
        {
            var legacy = Path.Combine(directory, "legacy");
            var canonical = Path.Combine(directory, "canonical");
            Child(legacy, name, false);
            DeleteFixtureKeys(name);
            string code = null;
            try { new DeviceIdentityService(canonical, name, false, legacy).GetIdentity(); }
            catch (DeviceIdentityException error) { code = error.Code; }
            Assert(code == "DEVICE_IDENTITY_LOST" && !File.Exists(Path.Combine(canonical, "identity.dat"))
                && !CngKey.Exists(name, CngProvider.MicrosoftSoftwareKeyStorageProvider),
                "legacy migration requires its original private key and cannot create a replacement identity");
        });
    }

    private static void TestCanonicalCorruptionNeverFallsBack()
    {
        WithFixture((directory, name) =>
        {
            var legacy = Path.Combine(directory, "legacy");
            var canonical = Path.Combine(directory, "canonical");
            Child(legacy, name, false);
            Directory.CreateDirectory(canonical);
            var corrupt = new byte[] { 1, 2, 3, 4 };
            File.WriteAllBytes(Path.Combine(canonical, "identity.dat"), corrupt);
            string code = null;
            try { new DeviceIdentityService(canonical, name, false, legacy).GetIdentity(); }
            catch (DeviceIdentityException error) { code = error.Code; }
            Assert(code == "DEVICE_IDENTITY_LOST"
                && corrupt.SequenceEqual(File.ReadAllBytes(Path.Combine(canonical, "identity.dat"))),
                "an existing canonical identity is never overwritten or silently replaced by a legacy copy");
        });
    }

    private static Snapshot ReadAndProve(DeviceIdentityService service)
    {
        var identity = service.GetIdentity();
        var keyHash = service.PublicKeyHash();
        var challengeId = Guid.NewGuid().ToString("D");
        var message = "3DM-DEVICE-V1|" + challengeId + "|" + new string('A', 43) + "|" + Guid.NewGuid().ToString("D")
            + "|" + identity.deviceId + "|VERIFY|" + keyHash;
        var signature = service.SignChallenge(challengeId, message);
        using (var rsa = new RSACng())
        {
            rsa.ImportParameters(new RSAParameters { Modulus = Base64Url(identity.publicKey.n), Exponent = Base64Url(identity.publicKey.e) });
            if (!rsa.VerifyData(Encoding.UTF8.GetBytes(message), Convert.FromBase64String(signature),
                HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) throw new Exception("Persisted key signature did not verify.");
        }
        return new Snapshot { DeviceId = identity.deviceId, KeyHash = keyHash, Protection = identity.keyProtection };
    }

    private static byte[] Base64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(normalized.PadRight((normalized.Length + 3) / 4 * 4, '='));
    }

    private static Snapshot Child(string directory, string name, bool preferTpm)
    {
        var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
            "child \"" + directory + "\" \"" + name + "\" " + preferTpm)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        using (var child = Process.Start(start))
        {
            if (!child.WaitForExit(30000)) { child.Kill(); throw new Exception("Identity child process exceeded 30 seconds."); }
            var output = child.StandardOutput.ReadToEnd();
            if (child.ExitCode != 0) throw new Exception("Identity child failed: " + child.StandardError.ReadToEnd());
            return Json.Deserialize<Snapshot>(output);
        }
    }

    private static void WithFixture(Action<string, string> action)
    {
        var directory = Path.Combine(Path.GetTempPath(), "3DsMood-identity-persistence-" + Guid.NewGuid().ToString("N"));
        var name = "3DsMood.IdentityPersistenceTest." + Guid.NewGuid().ToString("N");
        try { action(directory, name); }
        finally
        {
            DeleteFixtureKeys(name);
            var actual = Path.GetFullPath(directory);
            var temporary = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!actual.StartsWith(temporary, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(actual).StartsWith("3DsMood-identity-persistence-", StringComparison.Ordinal))
                throw new Exception("Refusing cleanup outside the allocated temporary fixture.");
            if (Directory.Exists(actual)) Directory.Delete(actual, true);
        }
    }

    private static void DeleteFixtureKeys(string name)
    {
        if (!name.StartsWith("3DsMood.IdentityPersistenceTest.", StringComparison.Ordinal))
            throw new Exception("Refusing to delete a non-test key.");
        foreach (var provider in new[] { new CngProvider("Microsoft Platform Crypto Provider"), CngProvider.MicrosoftSoftwareKeyStorageProvider })
        {
            try { if (CngKey.Exists(name, provider)) using (var key = CngKey.Open(name, provider)) key.Delete(); }
            catch (CryptographicException) { }
        }
    }

    private static void Assert(bool condition, string description)
    {
        if (!condition) throw new Exception("FAILED: " + description);
        Console.WriteLine("PASS " + description);
        passed++;
    }
}
