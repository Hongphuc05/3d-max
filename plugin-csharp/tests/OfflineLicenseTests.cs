using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using MaxWebViewHost;

internal static class OfflineLicenseTests
{
    static int passed;
    static void Assert(bool condition, string name) { if (!condition) throw new Exception(name); passed++; Console.WriteLine("PASS " + name); }
    static string Encode(byte[] value) { return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
    static string Sign(RSACryptoServiceProvider rsa, string machine, string extra = "")
    {
        var body = Encoding.UTF8.GetBytes("{\"version\":1,\"product\":\"3dsmood-library\",\"machineCode\":\"" + machine + "\",\"licenseId\":\"test-license\"" + extra + "}");
        return "MXL1." + Encode(body) + "." + Encode(rsa.SignData(body, CryptoConfig.MapNameToOID("SHA256")));
    }
    static void Reject(Action action, string name) { try { action(); } catch (InvalidDataException) { Assert(true, name); return; } throw new Exception("Accepted: " + name); }
    static int Main(string[] args)
    {
        string root = Path.Combine(Path.GetTempPath(), "max-license-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            if (args.Length == 3)
            {
                var integration = new OfflineLicenseService(File.ReadAllText(args[0]), root, args[2]);
                Assert(integration.Activate(File.ReadAllText(args[1])).licensed, "Node owner signature verifies in native net48 customer service");
                return 0;
            }
            using (var rsa = new RSACryptoServiceProvider(2048) { PersistKeyInCsp = false })
            {
                var machine = "MAX-" + new string('A', 64);
                var service = new OfflineLicenseService(rsa.ToXmlString(false), root, machine);
                Assert(!service.GetStatus().licensed, "unlicensed before activation");
                Reject(() => service.EnsureLicensed(), "imports fail closed before activation");
                var token = Sign(rsa, machine);
                Assert(service.Activate(token).licensed, "valid signed license activates");
                service.EnsureLicensed();
                Assert(new OfflineLicenseService(rsa.ToXmlString(false), root, machine).GetStatus().licensed, "license persists offline");
                Reject(() => service.Activate(Sign(rsa, "MAX-" + new string('B', 64))), "wrong machine rejected");
                Reject(() => service.Activate(token.Substring(0, token.Length - 8) + "AAAAAAAA"), "tampered signature rejected");
                Reject(() => service.Activate("invalid"), "malformed license rejected");
                Reject(() => service.Activate(new string('x', 17000)), "oversized license rejected");
                Reject(() => service.Activate(Sign(rsa, machine, ",\"expiresAt\":\"2099\"")), "unexpected expiry field rejected");
                using (var other = new RSACryptoServiceProvider(2048) { PersistKeyInCsp = false })
                    Reject(() => service.Activate(Sign(other, machine)), "untrusted issuer rejected");
                Assert(service.GetStatus().licensed, "invalid replacement preserves valid license");
                var moved = new OfflineLicenseService(rsa.ToXmlString(false), root, "MAX-" + new string('B', 64));
                Assert(!moved.GetStatus().licensed, "copied license does not unlock another machine");
                Reject(() => new OfflineLicenseService(rsa.ToXmlString(true), root, machine), "private key configuration rejected");
                Reject(() => new OfflineLicenseService("not RSA XML", root, machine), "malformed public key rejected with safe error");
                File.WriteAllText(Path.Combine(root, "license.txt"), "corrupt");
                Assert(!service.GetStatus().licensed, "corrupt saved license fails closed");
                Assert(service.Activate(token).licensed, "owner can reissue and customer can reactivate");
                Assert(OfflineLicenseService.CreateMachineCode("12345678-1234-1234-1234-123456789abc") == OfflineLicenseService.CreateMachineCode("12345678-1234-1234-1234-123456789ABC"), "machine identity normalization stable");
            }
            Console.WriteLine("Offline license tests: " + passed); return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
