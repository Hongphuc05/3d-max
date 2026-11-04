// P4.3 step 5: DeviceSessionService — challenge/verify against the v3 API with a fake server and an in-memory RSA signer.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using MaxWebViewHost;

class DeviceSessionTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage, string, HttpResponseMessage> Reply;
        public List<string> Calls = new List<string>();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            var body = r.Content == null ? "" : await r.Content.ReadAsStringAsync();
            lock (Calls) Calls.Add(r.Method + " " + r.RequestUri.PathAndQuery + (r.Headers.Authorization != null ? " [" + r.Headers.Authorization + "]" : ""));
            await Task.Delay(1);
            return Reply(r, body);
        }
    }
    sealed class Signer : IDeviceSigner
    {
        public RSA Key = RSA.Create(2048);
        public string Uuid = Guid.NewGuid().ToString("D");
        public Exception Fail;
        public PublicDeviceIdentity GetIdentity()
        {
            if (Fail != null) throw Fail;
            var p = Key.ExportParameters(false);
            return new PublicDeviceIdentity { deviceId = Uuid, keyProtection = "SOFTWARE", deviceName = "TEST-PC",
                publicKey = new PublicDeviceKey { kty = "RSA", n = B64u(p.Modulus), e = B64u(p.Exponent) } };
        }
        public string SignChallenge(string challengeId, string message)
        {
            if (Fail != null) throw Fail;
            return Convert.ToBase64String(Key.SignData(Encoding.UTF8.GetBytes(message), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        }
    }
    static string B64u(byte[] v) { return Convert.ToBase64String(v).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly string Machine = "MAX-" + new string('A', 64);
    static readonly Uri Api = new Uri("https://api.example.test/");
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static HttpResponseMessage Ok(object body, HttpStatusCode status = HttpStatusCode.OK)
    { return new HttpResponseMessage(status) { Content = new StringContent(Json.Serialize(body), Encoding.UTF8, "application/json") }; }
    static HttpResponseMessage Err(int status, string code)
    { return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent("{\"error\":{\"code\":\"" + code + "\",\"message\":\"Thông báo từ máy chủ.\",\"requestId\":\"r-1\"}}", Encoding.UTF8, "application/json") }; }
    static string Token(char c) { return new string(c, 43); }
    static Dictionary<string, object> Verified(string token, DateTime expires, object entitlements)
    {
        var d = new Dictionary<string, object> { { "deviceToken", token }, { "expiresAt", expires.ToString("o") } };
        if (entitlements != null) d["entitlements"] = entitlements;
        return d;
    }
    static Dictionary<string, object> NoRights() { return new Dictionary<string, object> { { "allModels", false }, { "modelIds", new string[0] } }; }

    // A server that follows the v3 contract: remembers the challenge, verifies the signature with the registered key.
    sealed class Server
    {
        public int Verifies, Challenges; public string LastChallengeBody; public string LastVerifyBody;
        public int TokenSeconds = 900; public char NextToken = 'a'; public bool AllModels; public string[] Models = new string[0];
        string challengeId, message; RSA pub;
        public HttpResponseMessage Handle(HttpRequestMessage r, string body)
        {
            var path = r.RequestUri.AbsolutePath;
            if (path == "/api/v1/device/challenge")
            {
                Challenges++; LastChallengeBody = body;
                var req = Json.Deserialize<Dictionary<string, object>>(body);
                var key = (Dictionary<string, object>)req["publicKey"];
                pub = RSA.Create(); pub.ImportParameters(new RSAParameters { Modulus = Unb64u((string)key["n"]), Exponent = Unb64u((string)key["e"]) });
                challengeId = Guid.NewGuid().ToString("D");
                message = "3DM-DEVICE-V2|" + challengeId + "|" + new string('N', 43) + "|" + req["deviceUuid"] + "|" + new string('f', 64);
                return Ok(new Dictionary<string, object> { { "challengeId", challengeId }, { "message", message }, { "expiresAt", DateTime.UtcNow.AddMinutes(2).ToString("o") } });
            }
            if (path == "/api/v1/device/verify")
            {
                Verifies++; LastVerifyBody = body;
                var req = Json.Deserialize<Dictionary<string, object>>(body);
                if ((string)req["challengeId"] != challengeId) return Err(403, "CHALLENGE_INVALID");
                if (!pub.VerifyData(Encoding.UTF8.GetBytes(message), Convert.FromBase64String((string)req["signature"]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                    return Err(403, "SIGNATURE_INVALID");
                var token = Token(NextToken); NextToken++;
                return Ok(Verified(token, DateTime.UtcNow.AddSeconds(TokenSeconds),
                    new Dictionary<string, object> { { "allModels", AllModels }, { "modelIds", Models } }));
            }
            if (path == "/api/v1/me/entitlements")
                return r.Headers.Authorization == null ? Err(401, "UNAUTHENTICATED")
                    : Ok(new Dictionary<string, object> { { "allModels", AllModels }, { "modelIds", Models } });
            return Err(404, "NOT_FOUND");
        }
    }
    static byte[] Unb64u(string v) { var n = v.Replace('-', '+').Replace('_', '/'); return Convert.FromBase64String(n.PadRight((n.Length + 3) / 4 * 4, '=')); }

    static void Main() { Run().GetAwaiter().GetResult(); }
    static async Task<string> CodeOf(Func<Task> action)
    {
        try { await action(); } catch (ApiException e) { return e.Code; }
        return null;
    }

    static async Task Run()
    {
        // 1. Happy path: challenge body shape, signed, verified, token cached.
        {
            var server = new Server { Models = new[] { "11111111-1111-4111-8111-111111111111" } }; var fake = new Fake { Reply = server.Handle };
            var signer = new Signer(); var now = DateTime.UtcNow;
            using (var svc = new DeviceSessionService(Api, signer, Machine, new HttpClient(fake), () => now))
            {
                var token = await svc.GetTokenAsync(CancellationToken.None);
                Check(token == Token('a'), "token returned from verify");
                var ch = Json.Deserialize<Dictionary<string, object>>(server.LastChallengeBody);
                Check(ch.Count == 5 && (string)ch["deviceUuid"] == signer.Uuid && (string)ch["keyProtection"] == "SOFTWARE" && (string)ch["machineCode"] == Machine && (string)ch["deviceName"] == "TEST-PC",
                    "challenge body has exactly the five contract fields");
                var key = (Dictionary<string, object>)ch["publicKey"];
                Check(key.Count == 3 && (string)key["kty"] == "RSA" && (string)key["e"] == "AQAB", "public key is sent as a three-field JWK");
                Check(!server.LastVerifyBody.Contains("legacyLicense"), "verify carries no legacy licence field");
                await svc.GetTokenAsync(CancellationToken.None);
                Check(fake.Calls.Count == 2, "second call reuses the cached token (no HTTP)");
                Check(svc.Current.Entitlements.AllModels == false && svc.Current.Entitlements.ModelIds.SequenceEqual(server.Models), "entitlements from verify are exposed");
                Check(fake.Calls.All(c => c.StartsWith("POST /api/v1/device/")), "only the two device endpoints were called, without Authorization");
            }
        }
        // 2. Refresh before expiry (60 s margin); a token with plenty of time is kept.
        {
            var server = new Server(); var fake = new Fake { Reply = server.Handle }; var now = DateTime.UtcNow;
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => now))
            {
                var a = await svc.GetTokenAsync(CancellationToken.None);
                now = now.AddSeconds(900 - 61);
                Check(await svc.GetTokenAsync(CancellationToken.None) == a, "61 s before expiry the token is still used");
                now = now.AddSeconds(2);
                var b = await svc.GetTokenAsync(CancellationToken.None);
                Check(b != a && server.Verifies == 2, "inside the 60 s margin a new session is made");
            }
        }
        // 3. Parallel callers share one authentication.
        {
            var server = new Server(); var fake = new Fake { Reply = server.Handle };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
            {
                var tokens = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => svc.GetTokenAsync(CancellationToken.None)));
                Check(tokens.Distinct().Count() == 1 && server.Challenges == 1 && server.Verifies == 1, "eight parallel callers cause one challenge and one verify");
            }
        }
        // 4. Invalidate forces a fresh session; entitlements refresh uses the bearer.
        {
            var server = new Server { AllModels = true }; var fake = new Fake { Reply = server.Handle };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
            {
                await svc.GetTokenAsync(CancellationToken.None);
                Check(svc.Current.Entitlements.AllModels, "ALL_MODELS granted by the server is visible");
                svc.Invalidate();
                Check(await svc.GetTokenAsync(CancellationToken.None) == Token('b'), "Invalidate() makes the next call authenticate again");
                server.Models = new[] { "22222222-2222-4222-8222-222222222222" };
                var ent = await svc.RefreshEntitlementsAsync(CancellationToken.None);
                Check(ent.ModelIds.SequenceEqual(server.Models) && fake.Calls.Last() == "GET /api/v1/me/entitlements [Device " + Token('b') + "]", "entitlement refresh sends 'Authorization: Device <token>'");
            }
        }
        // 5. Entitlement refresh with a rejected token re-authenticates once.
        {
            var server = new Server(); var fake = new Fake(); int meCalls = 0;
            fake.Reply = (r, b) => { if (r.RequestUri.AbsolutePath == "/api/v1/me/entitlements" && ++meCalls == 1) return Err(401, "UNAUTHENTICATED"); return server.Handle(r, b); };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
            {
                var ent = await svc.RefreshEntitlementsAsync(CancellationToken.None);
                Check(ent != null && server.Verifies == 2 && meCalls == 2, "a 401 on /me/entitlements triggers exactly one re-authentication and retry");
            }
        }
        // 6. Server errors surface as ApiException with the server code; bad responses are refused.
        {
            foreach (var pair in new[] { new[] { "DEVICE_BLOCKED", "403" }, new[] { "DEVICE_KEY_MISMATCH", "403" }, new[] { "RATE_LIMITED", "429" } })
            {
                var fake = new Fake { Reply = (r, b) => Err(int.Parse(pair[1]), pair[0]) };
                using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
                    Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == pair[0], "server error " + pair[0] + " is surfaced with its code");
            }
            var bad = new Dictionary<string, Func<HttpRequestMessage, string, HttpResponseMessage>>
            {
                { "html page", (r, b) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>captive portal</html>", Encoding.UTF8, "text/html") } },
                { "500 without envelope", (r, b) => new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("boom") } },
                { "redirect", (r, b) => { var x = new HttpResponseMessage(HttpStatusCode.Found); x.Headers.Location = new Uri("https://evil.test/"); return x; } },
                { "huge body", (r, b) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(new string('x', 200000)) } },
            };
            foreach (var entry in bad)
            {
                var fake = new Fake { Reply = entry.Value };
                using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
                    Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "'" + entry.Key + "' is reported as SERVER_UNAVAILABLE");
            }
            var malformed = new Dictionary<string, Func<HttpResponseMessage>>
            {
                { "token too short", () => Ok(Verified("short", DateTime.UtcNow.AddMinutes(10), NoRights())) },
                { "token with spaces", () => Ok(Verified(new string(' ', 43), DateTime.UtcNow.AddMinutes(10), NoRights())) },
                { "already expired", () => Ok(Verified(Token('z'), DateTime.UtcNow.AddMinutes(-1), NoRights())) },
                { "no entitlements", () => Ok(Verified(Token('z'), DateTime.UtcNow.AddMinutes(10), null)) },
                { "non-uuid model id", () => Ok(Verified(Token('z'), DateTime.UtcNow.AddMinutes(10),
                    new Dictionary<string, object> { { "allModels", false }, { "modelIds", new[] { "../x" } } })) },
            };
            foreach (var entry in malformed)
            {
                var server = new Server(); var fake = new Fake { Reply = (r, b) => r.RequestUri.AbsolutePath.EndsWith("verify") ? entry.Value() : server.Handle(r, b) };
                using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
                    Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE" && svc.Current == null, "malformed verify '" + entry.Key + "' is refused and nothing is cached");
            }
        }
        // 7. Identity problems and network loss.
        {
            var signer = new Signer { Fail = new DeviceIdentityException("DEVICE_IDENTITY_LOST", "mất") };
            using (var svc = new DeviceSessionService(Api, signer, Machine, new HttpClient(new Fake { Reply = new Server().Handle }), () => DateTime.UtcNow))
                Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "DEVICE_IDENTITY_LOST", "a lost device identity is reported with its own code");
            var offline = new Fake { Reply = (r, b) => { throw new HttpRequestException("no route"); } };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(offline), () => DateTime.UtcNow))
                Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "network failure is SERVER_UNAVAILABLE");
            var wrong = new Fake { Reply = (r, b) => Err(403, "CHALLENGE_INVALID") };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(wrong), () => DateTime.UtcNow))
                Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "CHALLENGE_INVALID", "CHALLENGE_INVALID is surfaced");
            using (var cts = new CancellationTokenSource())
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(new Fake { Reply = new Server().Handle }), () => DateTime.UtcNow))
            {
                cts.Cancel();
                try { await svc.GetTokenAsync(cts.Token); throw new Exception("cancelled call succeeded"); } catch (OperationCanceledException) { Check(true, "cancellation is honoured"); }
            }
        }
        // 8. A failed attempt is not cached: the next call tries again (no negative caching).
        {
            var server = new Server(); int n = 0; var fake = new Fake { Reply = (r, b) => ++n <= 1 ? Err(503, "INTERNAL") : server.Handle(r, b) };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(fake), () => DateTime.UtcNow))
            {
                await CodeOf(() => svc.GetTokenAsync(CancellationToken.None));
                Check(await svc.GetTokenAsync(CancellationToken.None) == Token('a'), "after a failure the next call authenticates normally");
            }
        }
        // 9. Wrong machine code format is refused at construction.
        {
            try { new DeviceSessionService(Api, new Signer(), "MAX-abc", new HttpClient(new Fake()), () => DateTime.UtcNow); throw new Exception("bad machine code accepted"); }
            catch (InvalidDataException) { Check(true, "an invalid machine code is refused"); }
        }
        // 10. BackendApi only ever talks to the configured host and only sends well-formed device tokens.
        {
            var api = new BackendApi(new Uri("https://api.example.test/"), new HttpClient(new Fake { Reply = (r, b) => Ok(new Dictionary<string, object>()) }));
            foreach (var bad in new[] { "//evil.test/x", "https://evil.test/x", "api/v1/x", "/a\\b", "/x#frag", null })
            {
                string code = null;
                try { api.Resolve(bad); } catch (ApiException e) { code = e.Code; }
                Check(code == "SERVER_UNAVAILABLE", "path '" + bad + "' is refused");
            }
            Check(api.Resolve("/api/v1/catalog?x=1").AbsoluteUri == "https://api.example.test/api/v1/catalog?x=1", "a plain API path resolves under the configured host");
            string tokenCode = null;
            try { await api.SendAsync(HttpMethod.Get, "/api/v1/me/entitlements", null, "bad token", null, 1000, CancellationToken.None); } catch (ApiException e) { tokenCode = e.Code; }
            Check(tokenCode == "SERVER_UNAVAILABLE", "a malformed device token is never put in a header");
            var seen = new List<string>();
            var spy = new BackendApi(Api, new HttpClient(new Fake { Reply = (r, b) => { seen.Add(r.Headers.Contains("Authorization") ? "auth" : "none"); return Ok(new Dictionary<string, object>()); } }));
            await spy.SendAsync(HttpMethod.Get, "/api/v1/catalog/version", null, null, null, 1000, CancellationToken.None);
            Check(seen[0] == "none", "no Authorization header when there is no token");
        }
        // 11. Error mapping and bounds inside BackendApi.
        {
            var noisy = Encoding.UTF8.GetBytes("{\"error\":{\"code\":\"DEVICE_BLOCKED\",\"message\":\"a\u0007b" + new string('z', 500) + "\"}}");
            var mapped = BackendApi.FromError(403, noisy);
            Check(mapped.Code == "DEVICE_BLOCKED" && mapped.Message.Length <= 300 && !mapped.Message.Any(char.IsControl), "server messages are trimmed to 300 characters and stripped of control characters");
            Check(BackendApi.FromError(302, Encoding.UTF8.GetBytes("{\"error\":{\"code\":\"DEVICE_BLOCKED\"}}")).Code == "SERVER_UNAVAILABLE", "a redirect status never yields a server error code");
            Check(BackendApi.FromError(400, Encoding.UTF8.GetBytes("{\"error\":{\"code\":\"lower_case\"}}")).Code == "SERVER_UNAVAILABLE", "an error code that is not UPPER_SNAKE is not trusted");
            try { await BackendApi.ReadBoundedAsync(new MemoryStream(new byte[100]), 10, CancellationToken.None); throw new Exception("limit ignored"); }
            catch (InvalidDataException) { Check(true, "a body over the limit is refused"); }
            var big = new Fake { Reply = (r, b) => new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new StringContent("{\"error\":{\"code\":\"DEVICE_BLOCKED\",\"message\":\"" + new string('x', 40000) + "\"}}") } };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(big), () => DateTime.UtcNow))
                Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "an error body larger than 16 KB is not parsed");
            var redirectWithBody = new Fake { Reply = (r, b) => { var x = new HttpResponseMessage(HttpStatusCode.Found) { Content = new StringContent("{\"error\":{\"code\":\"DEVICE_BLOCKED\"}}") }; x.Headers.Location = new Uri("https://evil.test/"); return x; } };
            using (var svc = new DeviceSessionService(Api, new Signer(), Machine, new HttpClient(redirectWithBody), () => DateTime.UtcNow))
                Check(await CodeOf(() => svc.GetTokenAsync(CancellationToken.None)) == "SERVER_UNAVAILABLE", "a redirect carrying an error body is still just 'unavailable'");
        }
        Console.WriteLine("Device session tests passed");
    }
}
