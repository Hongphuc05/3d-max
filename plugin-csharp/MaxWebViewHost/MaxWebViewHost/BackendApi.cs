using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    /// <summary>Source of the 15-minute device token (DeviceSessionService). Invalidate() = "the server rejected this token".</summary>
    internal interface IDeviceTokenSource
    {
        Task<string> GetTokenAsync(CancellationToken ct);
        void Invalidate();
    }

    /// <summary>A failure talking to the 3DS Mood API. Code is the server's v3 error code, or SERVER_UNAVAILABLE for anything else.</summary>
    internal sealed class ApiException : Exception
    {
        public string Code { get; private set; }
        public int Status { get; private set; }
        public ApiException(string code, int status, string message) : base(message) { Code = code; Status = status; }
        internal static ApiException Unavailable(int status = 0)
        { return new ApiException("SERVER_UNAVAILABLE", status, "Không kết nối được máy chủ. Kiểm tra Internet rồi thử lại."); }
    }

    internal sealed class ApiResponse
    {
        public int Status { get; set; }
        public byte[] Body { get; set; }
        public string ETag { get; set; }
        public bool NotModified { get { return Status == 304; } }
        internal Dictionary<string, object> Object()
        {
            try { return new JavaScriptSerializer { MaxJsonLength = BackendApi.JsonLimit, RecursionLimit = 16 }.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(Body)); }
            catch (Exception e) when (e is ArgumentException || e is InvalidOperationException) { throw ApiException.Unavailable(Status); }
        }
    }

    /// <summary>The only place that builds requests to the configured API host. Redirects are never followed, bodies are size-bounded,
    /// and every failure becomes an ApiException (server error code) or SERVER_UNAVAILABLE — never raw provider text.</summary>
    internal sealed class BackendApi
    {
        internal const int JsonLimit = 8 * 1024 * 1024;
        private static readonly Regex CodePattern = new Regex("^[A-Z][A-Z0-9_]{1,60}$", RegexOptions.CultureInvariant);
        private static readonly Regex TokenPattern = new Regex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant);
        private readonly Uri baseUri;
        private readonly HttpClient http;

        public BackendApi(Uri baseUri, HttpClient http)
        {
            if (baseUri == null || http == null) throw new ArgumentNullException();
            this.baseUri = baseUri; this.http = http;
        }

        internal Uri Resolve(string path)
        {
            Uri uri;
            if (path == null || !path.StartsWith("/", StringComparison.Ordinal) || path.StartsWith("//", StringComparison.Ordinal) || path.Contains("\\")
                || !Uri.TryCreate(baseUri, path, out uri) || uri.GetLeftPart(UriPartial.Authority) != baseUri.GetLeftPart(UriPartial.Authority)
                || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment))
                throw ApiException.Unavailable();
            return uri;
        }

        private HttpRequestMessage Build(HttpMethod method, string path, object jsonBody, string deviceToken, string ifNoneMatch)
        {
            var request = new HttpRequestMessage(method, Resolve(path));
            if (deviceToken != null)
            {
                if (!TokenPattern.IsMatch(deviceToken)) throw ApiException.Unavailable();
                request.Headers.TryAddWithoutValidation("Authorization", "Device " + deviceToken);
            }
            if (ifNoneMatch != null) request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
            if (jsonBody != null) request.Content = new StringContent(new JavaScriptSerializer().Serialize(jsonBody), Encoding.UTF8, "application/json");
            return request;
        }

        /// <summary>Buffered request (catalog, manifest, device endpoints). 304 is returned as a response, other non-2xx throws.</summary>
        public async Task<ApiResponse> SendAsync(HttpMethod method, string path, object jsonBody, string deviceToken, string ifNoneMatch, int limit, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using (var request = Build(method, path, jsonBody, deviceToken, ifNoneMatch))
                using (var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false))
                {
                    var status = (int)response.StatusCode;
                    if (status == 304) return new ApiResponse { Status = 304, Body = new byte[0], ETag = response.Headers.ETag != null ? response.Headers.ETag.ToString() : null };
                    var body = await ReadBodyAsync(response, status >= 200 && status < 300 ? limit : 16384, ct).ConfigureAwait(false);
                    if (status < 200 || status >= 300) throw FromError(status, body);
                    return new ApiResponse { Status = status, Body = body, ETag = response.Headers.ETag != null ? response.Headers.ETag.ToString() : null };
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e) when (e is HttpRequestException || e is IOException || e is OperationCanceledException || e is InvalidDataException || e is InvalidOperationException)
            { throw ApiException.Unavailable(); }
        }

        /// <summary>Streaming request (model download). The caller disposes the response; error statuses throw before any body is handed over.</summary>
        public async Task<HttpResponseMessage> OpenStreamAsync(string path, string deviceToken, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            HttpResponseMessage response = null;
            try
            {
                using (var request = Build(HttpMethod.Get, path, null, deviceToken, null))
                    response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
                var status = (int)response.StatusCode;
                if (status >= 200 && status < 300) { var ok = response; response = null; return ok; }
                throw FromError(status, await ReadBodyAsync(response, 16384, ct).ConfigureAwait(false));
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception e) when (e is HttpRequestException || e is IOException || e is OperationCanceledException || e is InvalidDataException || e is InvalidOperationException)
            { throw ApiException.Unavailable(); }
            finally { if (response != null) response.Dispose(); }
        }

        internal static ApiException FromError(int status, byte[] body)
        {
            if (status >= 300 && status < 400) return ApiException.Unavailable(status);
            try
            {
                var envelope = new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 8 }.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                var error = envelope != null && envelope.ContainsKey("error") ? envelope["error"] as Dictionary<string, object> : null;
                var code = error != null && error.ContainsKey("code") ? error["code"] as string : null;
                if (code != null && CodePattern.IsMatch(code))
                {
                    var message = error.ContainsKey("message") ? error["message"] as string : null;
                    message = message == null ? "Máy chủ từ chối yêu cầu." : new string(message.Where(c => !char.IsControl(c)).Take(300).ToArray());
                    return new ApiException(code, status, message);
                }
            }
            catch (Exception e) when (e is ArgumentException || e is InvalidOperationException) { }
            return ApiException.Unavailable(status);
        }

        private static async Task<byte[]> ReadBodyAsync(HttpResponseMessage response, int limit, CancellationToken ct)
        {
            if (response.Content == null) return new byte[0];
            return await ReadBoundedAsync(await response.Content.ReadAsStreamAsync().ConfigureAwait(false), limit, ct).ConfigureAwait(false);
        }

        internal static async Task<byte[]> ReadBoundedAsync(Stream input, int limit, CancellationToken ct)
        {
            using (var output = new MemoryStream())
            {
                var buffer = new byte[32768]; int read;
                while ((read = await input.ReadAsync(buffer, 0, buffer.Length, ct).ConfigureAwait(false)) > 0)
                {
                    if (output.Length + read > limit) throw new InvalidDataException("Phản hồi vượt giới hạn.");
                    output.Write(buffer, 0, read);
                }
                return output.ToArray();
            }
        }
    }
}
