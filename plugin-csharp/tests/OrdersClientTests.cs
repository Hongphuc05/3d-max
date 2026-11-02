// P5.8: OrdersClient — host gan token thiet bi cho cac yeu cau don hang cua UI (JS khong co token), loc body, thu lai khi 401.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using MaxWebViewHost;

class OrdersClientTests
{
    sealed class Fake : HttpMessageHandler
    {
        public Func<HttpRequestMessage, string, HttpResponseMessage> Reply;
        public List<string> Calls = new List<string>(); public List<string> Bodies = new List<string>();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken t)
        {
            var body = r.Content == null ? "" : await r.Content.ReadAsStringAsync();
            lock (Calls) { Calls.Add(r.Method + " " + r.RequestUri.PathAndQuery + " [" + (r.Headers.Authorization == null ? "" : r.Headers.Authorization.ToString()) + "]"); Bodies.Add(body); }
            return Reply(r, body);
        }
    }
    sealed class Tokens : IDeviceTokenSource
    {
        public int Invalidations; public int Issued; public string Current = new string('a', 43);
        public Task<string> GetTokenAsync(CancellationToken ct) { return Task.FromResult(Current); }
        public void Invalidate() { Invalidations++; Current = new string((char)('b' + Issued++), 43); }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly Uri Api = new Uri("https://api.example.test/");
    const string Id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    const string Order = "fedcbafe-dcba-4fed-8cba-fedcbafedcba";
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static HttpResponseMessage Reply(HttpStatusCode status, string body)
    { return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") }; }
    static HttpResponseMessage Err(int status, string code)
    { return Reply((HttpStatusCode)status, "{\"error\":{\"code\":\"" + code + "\",\"message\":\"x\",\"requestId\":\"r\"}}"); }
    static OrdersClient Make(Fake fake, Tokens tokens) { return new OrdersClient(new BackendApi(Api, new HttpClient(fake)), tokens); }
    static byte[] Bytes(string s) { return Encoding.UTF8.GetBytes(s); }
    static async Task<string> CodeOf(Func<Task> action)
    {
        try { await action(); } catch (ApiException e) { return e.Code + ":" + e.Status; }
        return null;
    }
    static void Main() { Run().GetAwaiter().GetResult(); }

    static async Task Run()
    {
        // 1. Create: only {items:[{modelId}]} goes upstream; client prices are dropped; the token is a header, never in the URL or body.
        {
            var fake = new Fake { Reply = (r, b) => Reply(HttpStatusCode.Created, "{\"orderId\":\"" + Order + "\"}") }; var tokens = new Tokens();
            var res = await Make(fake, tokens).HandleAsync(V3Route.OrderCreate, null, Bytes("{\"amountVnd\":1,\"items\":[{\"modelId\":\"" + Id.ToUpperInvariant() + "\",\"priceVnd\":1,\"scope\":\"ALL_MODELS\"}],\"coupon\":\"X\"}"), CancellationToken.None);
            Check(res.Status == 201 && Encoding.UTF8.GetString(res.Body).Contains(Order), "the server's 201 and body are passed through");
            Check(fake.Calls.Single() == "POST /api/v1/orders [Device " + tokens.Current + "]", "one POST to /api/v1/orders with the device token header");
            Check(fake.Bodies.Single() == "{\"items\":[{\"modelId\":\"" + Id + "\"}]}", "only normalised model ids are forwarded (prices, scope and unknown fields are dropped)");
            Check(!fake.Calls.Single().Replace("[Device " + tokens.Current + "]", "").Contains(tokens.Current) && !fake.Bodies.Single().Contains(tokens.Current), "the token is not in the URL or the body");
        }
        // 2. Invalid create bodies never reach the network.
        {
            var many = string.Join(",", Enumerable.Range(0, 21).Select(i => "{\"modelId\":\"00000000-0000-4000-8000-" + i.ToString("D12") + "\"}"));
            var bad = new Dictionary<string, string>
            {
                { "not json", "nope" }, { "array", "[]" }, { "no items", "{}" }, { "empty items", "{\"items\":[]}" }, { "items not array", "{\"items\":5}" },
                { "bad uuid", "{\"items\":[{\"modelId\":\"abc\"}]}" }, { "path traversal", "{\"items\":[{\"modelId\":\"../x\"}]}" }, { "no modelId", "{\"items\":[{}]}" },
                { "duplicate", "{\"items\":[{\"modelId\":\"" + Id + "\"},{\"modelId\":\"" + Id + "\"}]}" }, { "too many", "{\"items\":[" + many + "]}" },
                { "item not object", "{\"items\":[\"x\"]}" }, { "empty body", "" },
            };
            foreach (var entry in bad)
            {
                var fake = new Fake { Reply = (r, b) => Reply(HttpStatusCode.Created, "{}") };
                Check(await CodeOf(() => Make(fake, new Tokens()).HandleAsync(V3Route.OrderCreate, null, Bytes(entry.Value), CancellationToken.None)) == "INVALID_PARAMS:400" && fake.Calls.Count == 0, "create body '" + entry.Key + "' is refused locally");
            }
        }
        // 3. Get / claim / cancel use the order id from the route; bad ids and wrong routes are refused before any request.
        {
            var fake = new Fake { Reply = (r, b) => Reply(HttpStatusCode.OK, "{\"status\":\"AWAITING_OWNER\"}") }; var client = Make(fake, new Tokens());
            await client.HandleAsync(V3Route.OrderGet, Order, null, CancellationToken.None);
            await client.HandleAsync(V3Route.OrderClaim, Order.ToUpperInvariant(), null, CancellationToken.None);
            await client.HandleAsync(V3Route.OrderCancel, Order, null, CancellationToken.None);
            Check(fake.Calls.Select(c => c.Substring(0, c.IndexOf(" [", StringComparison.Ordinal))).SequenceEqual(new[] { "GET /api/v1/orders/" + Order, "POST /api/v1/orders/" + Order + "/claim-paid", "POST /api/v1/orders/" + Order + "/cancel" }),
                "get, claim-paid and cancel map to the right API paths (ids lower-cased)");
            Check(fake.Bodies.All(b => b == ""), "claim and cancel send no body");
            foreach (var bad in new[] { null, "", "abc", "../" + Order, Order + "/x", Order + "?x=1" })
                Check(await CodeOf(() => client.HandleAsync(V3Route.OrderGet, bad, null, CancellationToken.None)) == "ORDER_NOT_FOUND:404", "order id '" + bad + "' is refused locally");
            Check(await CodeOf(() => client.HandleAsync(V3Route.Catalog, Order, null, CancellationToken.None)) == "INVALID_PARAMS:400", "a non-order route is not served by this client");
            Check(fake.Calls.Count == 3, "refused requests made no network call");
        }
        // 4. A rejected token is renewed once; a persistent rejection stops.
        {
            var tokens = new Tokens(); int n = 0; var fake = new Fake { Reply = (r, b) => ++n == 1 ? Err(401, "UNAUTHENTICATED") : Reply(HttpStatusCode.OK, "{\"status\":\"CANCELLED\"}") };
            var res = await Make(fake, tokens).HandleAsync(V3Route.OrderCancel, Order, null, CancellationToken.None);
            Check(res.Status == 200 && tokens.Invalidations == 1 && fake.Calls.Count == 2 && fake.Calls[1].Contains(tokens.Current), "401 renews the token once and retries with the new one");
            var always = new Fake { Reply = (r, b) => Err(401, "UNAUTHENTICATED") }; var t2 = new Tokens();
            Check(await CodeOf(() => Make(always, t2).HandleAsync(V3Route.OrderGet, Order, null, CancellationToken.None)) == "UNAUTHENTICATED:401" && always.Calls.Count == 2, "a second 401 is returned, no loop");
        }
        // 5. Server errors keep their code and status; network loss is SERVER_UNAVAILABLE.
        {
            foreach (var pair in new[] { new[] { "ALREADY_ENTITLED", "409" }, new[] { "TOO_MANY_PENDING_ORDERS", "429" }, new[] { "PAYMENT_NOT_CONFIGURED", "503" }, new[] { "ORDER_STATE_INVALID", "409" }, new[] { "MODEL_NOT_AVAILABLE", "409" } })
            {
                var fake = new Fake { Reply = (r, b) => Err(int.Parse(pair[1]), pair[0]) };
                Check(await CodeOf(() => Make(fake, new Tokens()).HandleAsync(V3Route.OrderCreate, null, Bytes("{\"items\":[{\"modelId\":\"" + Id + "\"}]}"), CancellationToken.None)) == pair[0] + ":" + pair[1], pair[0] + " keeps its code and status");
            }
            var down = new Fake { Reply = (r, b) => { throw new HttpRequestException("down"); } };
            Check(await CodeOf(() => Make(down, new Tokens()).HandleAsync(V3Route.OrderGet, Order, null, CancellationToken.None)) == "SERVER_UNAVAILABLE:0", "network failure is SERVER_UNAVAILABLE");
            using (var cts = new CancellationTokenSource())
            {
                cts.Cancel();
                try { await Make(new Fake { Reply = (r, b) => Reply(HttpStatusCode.OK, "{}") }, new Tokens()).HandleAsync(V3Route.OrderGet, Order, null, cts.Token); throw new Exception("cancelled call succeeded"); }
                catch (OperationCanceledException) { Check(true, "cancellation is honoured"); }
            }
        }
        Console.WriteLine("Orders client tests passed");
    }
}
