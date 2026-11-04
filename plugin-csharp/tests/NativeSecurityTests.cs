using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using MaxWebViewHost;

internal static class NativeSecurityTests
{
    private static int passed;
    private static void Assert(bool condition, string name)
    {
        if (!condition) throw new Exception("FAILED: " + name);
        Console.WriteLine("PASS " + name);
        passed++;
    }
    private static void Reject(Action action, string code, string name)
    {
        try { action(); }
        catch (DeviceIdentityException e) { Assert(e.Code == code, name); return; }
        throw new Exception("FAILED (accepted): " + name);
    }
    private static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "3DsMood-native-tests-" + Guid.NewGuid().ToString("N"));
        var keyName = "3DsMood.Test." + Guid.NewGuid().ToString("N");
        try
        {
            TestPolicy();
            var identity = new DeviceIdentityService(root, keyName, false);
            var first = identity.GetIdentity();
            var second = new DeviceIdentityService(root, keyName, false).GetIdentity();
            Assert(first.deviceId == second.deviceId && first.publicKey.n == second.publicKey.n,
                "UUID and CNG key persist across service instances");
            Assert(first.keyProtection == "SOFTWARE", "software fallback is explicitly identified");
            using (var key = CngKey.Open(keyName, CngProvider.MicrosoftSoftwareKeyStorageProvider))
            {
                Assert(key.ExportPolicy == CngExportPolicies.None, "CNG private key is nonexportable");
                var refused = false;
                try { key.Export(CngKeyBlobFormat.Pkcs8PrivateBlob); } catch (CryptographicException) { refused = true; }
                Assert(refused, "private key export is rejected by CNG");
                var challengeId = Guid.NewGuid().ToString();
                var message = "3DM-DEVICE-V1|" + challengeId + "|" + new string('A', 43) + "|" +
                    Guid.NewGuid() + "|" + first.deviceId + "|VERIFY|" + identity.PublicKeyHash();
                var signature = identity.SignChallenge(challengeId, message);
                using (var rsa = new RSACng(key))
                    Assert(rsa.VerifyData(Encoding.UTF8.GetBytes(message), Convert.FromBase64String(signature),
                        HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "challenge signature verifies");
                Reject(() => identity.SignChallenge(Guid.NewGuid().ToString(), message), "INVALID_PARAMS", "challenge ID mismatch rejected");
                Reject(() => identity.SignChallenge(challengeId, message.Replace(first.deviceId, Guid.NewGuid().ToString())), "INVALID_PARAMS", "other device ID rejected");
                Reject(() => identity.SignChallenge(challengeId, message.Replace(identity.PublicKeyHash(), new string('0', 64))), "INVALID_PARAMS", "other public key hash rejected");
                Reject(() => identity.SignChallenge(challengeId, message.Replace("VERIFY", "TRANSFER")), "INVALID_PARAMS", "arbitrary signing purpose rejected");
                Reject(() => identity.SignChallenge(challengeId, "arbitrary document"), "INVALID_PARAMS", "arbitrary document signing rejected");
                var fixture = new { identity = first, challengeId, message, signature, spkiHash = identity.PublicKeyHash() };
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native-proof.json"),
                    new JavaScriptSerializer().Serialize(fixture));
            }
            var metadata = Path.Combine(root, "identity.dat");
            var encrypted = File.ReadAllBytes(metadata);
            Assert(!Encoding.UTF8.GetString(encrypted).Contains(first.deviceId), "UUID metadata is DPAPI encrypted");
            File.WriteAllBytes(metadata, new byte[] { 1, 2, 3 });
            Reject(() => new DeviceIdentityService(root, keyName, false).GetIdentity(), "DEVICE_IDENTITY_LOST", "tampered metadata fails closed");
            File.Delete(metadata);
            Reject(() => new DeviceIdentityService(root, keyName, false).GetIdentity(), "DEVICE_IDENTITY_LOST", "deleted metadata cannot replace existing identity");
            File.WriteAllBytes(metadata, encrypted);
            using (var key = CngKey.Open(keyName, CngProvider.MicrosoftSoftwareKeyStorageProvider)) key.Delete();
            Reject(() => new DeviceIdentityService(root, keyName, false).GetIdentity(), "DEVICE_IDENTITY_LOST", "missing key cannot replace persisted identity");
            Console.WriteLine("Native tests passed: " + passed);
        }
        finally
        {
            if (CngKey.Exists(keyName, CngProvider.MicrosoftSoftwareKeyStorageProvider))
                using (var key = CngKey.Open(keyName, CngProvider.MicrosoftSoftwareKeyStorageProvider)) key.Delete();
            // Only the unique directory created by this harness is removed.
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
    private static void TestPolicy()
    {
        var origins = new[] { new Uri("http://localhost:5173"), new Uri("https://app.example.com") };
        Assert(BridgePolicy.IsTrusted("http://localhost:5173/license", origins, null), "configured loopback origin accepted");
        Assert(!BridgePolicy.IsTrusted("http://localhost:51730/license", origins, null), "different port rejected");
        Assert(!BridgePolicy.IsTrusted("https://app.example.com.evil.test/", origins, null), "suffix origin rejected");
        Assert(!BridgePolicy.IsTrusted("https://user@app.example.com/", origins, null), "credential URL rejected");
        Assert(!BridgePolicy.IsTrusted("file:///C:/temp/evil.html", origins, "file:///C:/temp/index.html"), "diagnostic sibling file rejected");
        Assert(!BridgePolicy.CanOpenExternal("file:///C:/Windows/system32/cmd.exe"), "external file execution rejected");
        Assert(!BridgePolicy.CanOpenExternal("javascript:alert(1)"), "external javascript rejected");
        Assert(BridgePolicy.CanOpenExternal("https://pay.payos.vn/test"), "HTTPS checkout link supported");
        Dictionary<string, object> parsed;
        string code;
        const string valid = "{\"id\":\"test-1\",\"version\":1,\"method\":\"device.getIdentity\",\"params\":{}}";
        Assert(BridgePolicy.TryParse(valid, out parsed, out code), "typed version one envelope accepted");
        Assert(BridgePolicy.TryParse(valid.Replace("device.getIdentity", "library.status"), out parsed, out code), "library status accepted");
        Assert(BridgePolicy.TryParse(valid.Replace("device.getIdentity", "library.refresh"), out parsed, out code), "catalog refresh accepted");
        var import = valid.Replace("device.getIdentity", "asset.import").Replace("\"params\":{}", "\"params\":{\"modelId\":\"3f2a8a9e-1c1b-4c1e-9f1e-0123456789ab\"}");
        Assert(BridgePolicy.TryParse(import, out parsed, out code), "model-ID-only import accepted");
        Assert(!BridgePolicy.TryParse(import.Replace("3f2a8a9e-1c1b-4c1e-9f1e-0123456789ab", "../chair"), out parsed, out code), "traversal ID rejected");
        Assert(!BridgePolicy.TryParse(import.Replace("\"3f2a8a9e-1c1b-4c1e-9f1e-0123456789ab\"", "\"3f2a8a9e-1c1b-4c1e-9f1e-0123456789ab\",\"url\":\"https://evil.test\""), out parsed, out code), "import cannot provide URL");
        var activate = valid.Replace("device.getIdentity", "library.activate").Replace("\"params\":{}", "\"params\":{\"license\":\"signed-token\"}");
        Assert(!BridgePolicy.TryParse(activate, out parsed, out code), "manual license activation is gone from the allowlist");
        Assert(!BridgePolicy.TryParse(import.Replace("modelId", "assetId"), out parsed, out code), "asset ID import (old offline library) rejected");
        Assert(!BridgePolicy.TryParse(valid.Replace("\"version\":1", "\"version\":2"), out parsed, out code), "unknown bridge version rejected");
        Assert(!BridgePolicy.TryParse(valid.Replace("\"params\":{}", "\"params\":[]"), out parsed, out code), "array params rejected");
        Assert(!BridgePolicy.TryParse(valid.Replace("\"params\":{}", "\"params\":{\"privateKey\":\"bad\"}"), out parsed, out code), "unexpected method params rejected");
        Assert(!BridgePolicy.TryParse(valid.Replace("device.getIdentity", "executeScript"), out parsed, out code), "unknown method rejected");
        Assert(!BridgePolicy.TryParse(new string('A', 17000), out parsed, out code), "oversized bridge message rejected");
    }
}
