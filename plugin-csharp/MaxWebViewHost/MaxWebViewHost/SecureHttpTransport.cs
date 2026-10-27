using System;
using System.Net.Http;
using System.Security.Authentication;

namespace MaxWebViewHost
{
    internal static class SecureHttpTransport
    {
        internal static HttpClientHandler CreateHandler(bool allowAutoRedirect, bool useCookies)
        {
            return new HttpClientHandler
            {
                AllowAutoRedirect = allowAutoRedirect,
                UseCookies = useCookies,
                SslProtocols = SslProtocols.Tls12
            };
        }

        internal static HttpClient CreateClient(bool allowAutoRedirect, bool useCookies, TimeSpan timeout)
        {
            return new HttpClient(CreateHandler(allowAutoRedirect, useCookies)) { Timeout = timeout };
        }
    }
}
