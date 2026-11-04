using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace MaxWebViewHost
{
    internal sealed class Entitlements
    {
        public bool AllModels { get; set; }
        public string[] ModelIds { get; set; }
        public bool Allows(string modelId) { return AllModels || ModelIds.Contains(modelId, StringComparer.OrdinalIgnoreCase); }
    }

    internal sealed class DeviceSession
    {
        public string Token { get; set; }
        public DateTime ExpiresUtc { get; set; }
        public Entitlements Entitlements { get; set; }
    }

    /// <summary>Signs the server's challenge with the device key and keeps the 15-minute device token fresh. No account, no cookies.</summary>
    internal sealed class DeviceSessionService : IDeviceTokenSource, IDisposable
    {
        private static readonly TimeSpan Margin = TimeSpan.FromSeconds(60);
        private static readonly Regex TokenPattern = new Regex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant);
        private static readonly Regex UuidPattern = new Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", RegexOptions.CultureInvariant);
        private readonly BackendApi api;
        private readonly HttpClient http;
        private readonly IDeviceSigner signer;
        private readonly string machineCode;
        private readonly Func<string> legacyLicense;
        private readonly Func<DateTime> utcNow;
        private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1);
        private volatile DeviceSession current;
        private int generation;

        public DeviceSessionService(Uri apiBase, IDeviceSigner signer, string machineCode, Func<string> legacyLicense, HttpClient http, Func<DateTime> utcNow)
        {
            if (apiBase == null || signer == null || http == null) throw new ArgumentNullException();
            if (!Regex.IsMatch(machineCode ?? "", "\\AMAX-[A-F0-9]{64}\\z")) throw new InvalidDataException("Mã máy không hợp lệ.");
            this.signer = signer; this.machineCode = machineCode; this.http = http;
            this.legacyLicense = legacyLicense ?? (() => null);
            this.utcNow = utcNow ?? (() => DateTime.UtcNow);
            api = new BackendApi(apiBase, http);
        }

        /// <summary>The session in use, or null before the first successful authentication.</summary>
        public DeviceSession Current { get { return current; } }

        public void Invalidate() { Interlocked.Increment(ref generation); current = null; }

        /// <summary>Verify a candidate license before saving it; failures preserve any previously saved license.</summary>
        public async Task<bool> ActivateLicenseAsync(string license, Action save, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(license) || save == null) throw new ArgumentNullException();
            Invalidate();
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var started = Volatile.Read(ref generation);
                var session = await AuthenticateAsync(ct, license.Trim()).ConfigureAwait(false);
                if (!session.Entitlements.AllModels) return false;
                await OffThread(() => { save(); return true; }).ConfigureAwait(false);
                if (started == Volatile.Read(ref generation)) current = session;
                return true;
            }
            finally { gate.Release(); }
        }

        public async Task<string> GetTokenAsync(CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            var session = current;
            if (Fresh(session)) return session.Token;
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                session = current;
                if (Fresh(session)) return session.Token;
                while (true)
                {
                    var started = Volatile.Read(ref generation);
                    session = await AuthenticateAsync(ct).ConfigureAwait(false);
                    if (started != Volatile.Read(ref generation)) continue;
                    current = session;
                    // An activation may invalidate the session while authentication is in flight.
                    if (started == Volatile.Read(ref generation)) return session.Token;
                    current = null;
                }
            }
            finally { gate.Release(); }
        }

        /// <summary>Re-reads the rights from the server; a rejected token triggers one re-authentication.</summary>
        public async Task<Entitlements> RefreshEntitlementsAsync(CancellationToken ct)
        {
            for (var attempt = 0; ; attempt++)
            {
                var token = await GetTokenAsync(ct).ConfigureAwait(false);
                try
                {
                    var response = await api.SendAsync(HttpMethod.Get, "/api/v1/me/entitlements", null, token, null, 1024 * 1024, ct).ConfigureAwait(false);
                    var rights = ParseEntitlements(response.Object());
                    var session = current;
                    if (session != null && session.Token == token) session.Entitlements = rights;
                    return rights;
                }
                catch (ApiException e) when (e.Code == "UNAUTHENTICATED" && attempt == 0) { Invalidate(); }
            }
        }

        private bool Fresh(DeviceSession session) { return session != null && utcNow() < session.ExpiresUtc - Margin; }

        private async Task<DeviceSession> AuthenticateAsync(CancellationToken ct, string candidateLicense = null)
        {
            PublicDeviceIdentity identity;
            try { identity = await OffThread(() => signer.GetIdentity()).ConfigureAwait(false); }
            catch (DeviceIdentityException e) { throw new ApiException(e.Code, 0, e.Message); }
            var challenge = (await api.SendAsync(HttpMethod.Post, "/api/v1/device/challenge", new Dictionary<string, object>
            {
                { "deviceUuid", identity.deviceId },
                { "publicKey", new Dictionary<string, object> { { "kty", identity.publicKey.kty }, { "n", identity.publicKey.n }, { "e", identity.publicKey.e } } },
                { "keyProtection", identity.keyProtection },
                { "machineCode", machineCode },
                { "deviceName", identity.deviceName },
            }, null, null, 65536, ct).ConfigureAwait(false)).Object();
            var challengeId = Text(challenge, "challengeId");
            var message = Text(challenge, "message");
            string signature;
            try { signature = await OffThread(() => signer.SignChallenge(challengeId, message)).ConfigureAwait(false); }
            catch (DeviceIdentityException e) { throw new ApiException(e.Code, 0, e.Message); }
            var verify = new Dictionary<string, object> { { "challengeId", challengeId }, { "signature", signature } };
            var license = candidateLicense ?? legacyLicense();
            if (!string.IsNullOrWhiteSpace(license)) verify["legacyLicense"] = license.Trim();
            var result = (await api.SendAsync(HttpMethod.Post, "/api/v1/device/verify", verify, null, null, 1024 * 1024, ct).ConfigureAwait(false)).Object();

            var token = Text(result, "deviceToken");
            DateTime expires;
            if (!TokenPattern.IsMatch(token)
                || !DateTime.TryParse(Text(result, "expiresAt"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out expires)
                || expires <= utcNow()) throw ApiException.Unavailable();
            var entitlements = result.ContainsKey("entitlements") ? result["entitlements"] as Dictionary<string, object> : null;
            if (entitlements == null) throw ApiException.Unavailable();
            return new DeviceSession { Token = token, ExpiresUtc = expires, Entitlements = ParseEntitlements(entitlements) };
        }

        private static string Text(Dictionary<string, object> source, string name)
        {
            object value;
            var text = source != null && source.TryGetValue(name, out value) ? value as string : null;
            if (string.IsNullOrEmpty(text) || text.Length > 2048) throw ApiException.Unavailable();
            return text;
        }

        internal static Entitlements ParseEntitlements(Dictionary<string, object> source)
        {
            object all, ids;
            if (source == null || !source.TryGetValue("allModels", out all) || !(all is bool) || !source.TryGetValue("modelIds", out ids) || !(ids is IEnumerable) || ids is string)
                throw ApiException.Unavailable();
            var list = ((IEnumerable)ids).Cast<object>().ToList();
            if (list.Count > 10000 || list.Any(i => !(i is string) || !UuidPattern.IsMatch((string)i))) throw ApiException.Unavailable();
            return new Entitlements { AllModels = (bool)all, ModelIds = list.Cast<string>().Select(s => s.ToLowerInvariant()).ToArray() };
        }

        // CNG/DPAPI calls block and take a cross-process mutex: keep them off the caller's context (as MaxWebViewForm.RunDeviceOperation does).
        private static Task<T> OffThread<T>(Func<T> action)
        {
            if (ExecutionContext.IsFlowSuppressed()) return Task.Run(action);
            using (ExecutionContext.SuppressFlow()) return Task.Run(action);
        }

        public void Dispose() { gate.Dispose(); http.Dispose(); }
    }
}
