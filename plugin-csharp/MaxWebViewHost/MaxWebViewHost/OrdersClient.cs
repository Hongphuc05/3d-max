using System;
using System.Collections;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    /// <summary>Order calls of the web UI (P5). The UI has no device token: the host adds it, forwards only {items:[{modelId}]} on create
    /// (price and anything else the page sends is dropped; the server prices from its DB) and renews the token once on 401.</summary>
    internal sealed class OrdersClient
    {
        private const int MaxItems = 20, ResponseLimit = 64 * 1024;
        private static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.CultureInvariant);
        private readonly BackendApi api;
        private readonly IDeviceTokenSource tokens;

        public OrdersClient(BackendApi api, IDeviceTokenSource tokens)
        {
            if (api == null || tokens == null) throw new ArgumentNullException();
            this.api = api; this.tokens = tokens;
        }

        private static ApiException Invalid() { return new ApiException("INVALID_PARAMS", 400, "Yêu cầu không hợp lệ."); }

        /// <summary>arg = order id for Get/Claim/Cancel; body = the page's JSON for Create.</summary>
        public async Task<ApiResponse> HandleAsync(V3Route route, string arg, byte[] body, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            HttpMethod method; string path; object json = null;
            if (route == V3Route.OrderCreate) { method = HttpMethod.Post; path = "/api/v1/orders"; json = CreateBody(body); }
            else if (route == V3Route.OrderGet || route == V3Route.OrderClaim || route == V3Route.OrderCancel)
            {
                var id = arg == null ? null : arg.ToLowerInvariant();
                if (id == null || !Uuid.IsMatch(id)) throw new ApiException("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng.");
                method = route == V3Route.OrderGet ? HttpMethod.Get : HttpMethod.Post;
                path = "/api/v1/orders/" + id + (route == V3Route.OrderClaim ? "/claim-paid" : route == V3Route.OrderCancel ? "/cancel" : "");
            }
            else throw Invalid();
            for (var attempt = 0; ; attempt++)
            {
                var token = await tokens.GetTokenAsync(ct).ConfigureAwait(false);
                try { return await api.SendAsync(method, path, json, token, null, ResponseLimit, ct).ConfigureAwait(false); }
                catch (ApiException e) when (e.Code == "UNAUTHENTICATED" && attempt == 0) { tokens.Invalidate(); }
            }
        }

        private static object CreateBody(byte[] body)
        {
            if (body == null || body.Length == 0 || body.Length > 4096) throw Invalid();
            Dictionary<string, object> parsed;
            try { parsed = new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 8 }.Deserialize<Dictionary<string, object>>(System.Text.Encoding.UTF8.GetString(body)); }
            catch (Exception e) when (e is ArgumentException || e is InvalidOperationException) { throw Invalid(); }
            var items = parsed != null && parsed.ContainsKey("items") ? parsed["items"] as IList : null;
            if (items == null || items.Count < 1 || items.Count > MaxItems) throw Invalid();
            var seen = new HashSet<string>(); var clean = new List<object>();
            foreach (var item in items)
            {
                var dict = item as Dictionary<string, object>;
                var id = dict != null && dict.ContainsKey("modelId") ? dict["modelId"] as string : null;
                id = id == null ? null : id.ToLowerInvariant();
                if (id == null || !Uuid.IsMatch(id) || !seen.Add(id)) throw Invalid();
                clean.Add(new Dictionary<string, object> { { "modelId", id } });
            }
            return new Dictionary<string, object> { { "items", clean } };
        }
    }
}
