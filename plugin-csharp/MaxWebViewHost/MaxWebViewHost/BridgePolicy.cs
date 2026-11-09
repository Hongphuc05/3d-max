using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    /// <summary>Pure validation shared by the WebView transport and standalone security tests.</summary>
    internal static class BridgePolicy
    {
        private static readonly Regex RequestId = new Regex("^[A-Za-z0-9_-]{1,80}$", RegexOptions.CultureInvariant);
        private static readonly Regex AssetId = new Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$", RegexOptions.CultureInvariant);
        private static readonly Regex ModelUuid = new Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", RegexOptions.CultureInvariant);
        private static readonly Regex Ticket = new Regex("^[A-Za-z0-9_-]{16,128}$", RegexOptions.CultureInvariant);
        internal static readonly string[] Methods = {
            "host.ping", "host.getInfo", "host.checkUpdate", "host.applyUpdate", "scene.getInfo", "scene.getSelection", "scene.createBox",
            "design.create", "asset.download", "asset.import", "device.getIdentity", "device.signChallenge",
            "library.status", "library.refresh", "library.downloads", "library.importOptions", "library.settings", "library.chooseDownloadDirectory",
            "library.favorites", "library.setFavorite", "library.setFavoriteFolder", "library.createFavoriteFolder", "library.renameFavoriteFolder", "library.deleteFavoriteFolder"
        };

        internal static bool IsTrusted(string value, Uri[] origins, string diagnosticUri)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || !string.IsNullOrEmpty(uri.UserInfo)) return false;
            if (uri.IsFile)
            {
                Uri diagnostic;
                return Uri.TryCreate(diagnosticUri, UriKind.Absolute, out diagnostic) && diagnostic.IsFile
                    && string.Equals(uri.LocalPath, diagnostic.LocalPath, StringComparison.OrdinalIgnoreCase)
                    && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);
            }
            if (!CanOpenExternal(value)) return false;
            return origins != null && origins.Any(o => o.Scheme == uri.Scheme
                && string.Equals(o.Host, uri.Host, StringComparison.OrdinalIgnoreCase) && o.Port == uri.Port);
        }

        internal static bool CanOpenExternal(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && string.IsNullOrEmpty(uri.UserInfo)
                && (uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback));
        }

        internal static bool SameDocument(string left, string right)
        {
            Uri a, b;
            return Uri.TryCreate(left, UriKind.Absolute, out a) && Uri.TryCreate(right, UriKind.Absolute, out b)
                && Uri.Compare(a, b, UriComponents.AbsoluteUri, UriFormat.SafeUnescaped, StringComparison.Ordinal) == 0;
        }

        internal static bool TryParse(string json, out Dictionary<string, object> message, out string code)
        {
            message = null;
            code = "INVALID_MESSAGE";
            if (json == null || json.Length > 16384) return false;
            try { message = new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 8 }.Deserialize<Dictionary<string, object>>(json); }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
            if (message == null || message.Count != 4 || !HasOnly(message, "id", "version", "method", "params")) return false;
            object id, version, method, parameters;
            if (!message.TryGetValue("id", out id) || !(id is string) || !RequestId.IsMatch((string)id)
                || !message.TryGetValue("version", out version) || !(version is int) || (int)version != 1
                || !message.TryGetValue("method", out method) || !(method is string)
                || !message.TryGetValue("params", out parameters) || !(parameters is Dictionary<string, object>)) return false;
            code = "UNKNOWN_METHOD";
            if (!Methods.Contains((string)method)) return false;
            code = "INVALID_PARAMS";
            return ValidateParams((string)method, (Dictionary<string, object>)parameters);
        }

        internal static string ResponseId(Dictionary<string, object> message)
        {
            object id;
            return message != null && message.TryGetValue("id", out id) && id is string
                && RequestId.IsMatch((string)id) ? (string)id : null;
        }

        private static bool ValidateParams(string method, Dictionary<string, object> p)
        {
            switch (method)
            {
                case "library.chooseDownloadDirectory":
                    return HasOnly(p, "contentDomain") && (!p.ContainsKey("contentDomain")
                        || (p["contentDomain"] is string && new[] { "3dmodels", "3dscenes" }.Contains((string)p["contentDomain"])));
                case "library.setFavorite":
                    return p.Count == 2 && HasOnly(p, "modelId", "favorite") && Text(p, "modelId", 36)
                        && ModelUuid.IsMatch((string)p["modelId"]) && p["favorite"] is bool;
                case "library.setFavoriteFolder":
                    return p.Count == 2 && HasOnly(p, "modelId", "folderId") && Text(p, "modelId", 36) && ModelUuid.IsMatch((string)p["modelId"])
                        && Text(p, "folderId", 36) && ((string)p["folderId"] == "default" || ModelUuid.IsMatch((string)p["folderId"]));
                case "library.createFavoriteFolder":
                    return p.Count == 2 && HasOnly(p, "name", "contentDomain") && Text(p, "name", 40)
                        && p["contentDomain"] is string && new[] { "3dmodels", "3dscenes" }.Contains((string)p["contentDomain"]);
                case "library.renameFavoriteFolder":
                    return p.Count == 2 && HasOnly(p, "folderId", "name") && Text(p, "folderId", 36) && ModelUuid.IsMatch((string)p["folderId"]) && Text(p, "name", 40);
                case "library.deleteFavoriteFolder":
                    return p.Count == 1 && HasOnly(p, "folderId") && Text(p, "folderId", 36) && ModelUuid.IsMatch((string)p["folderId"]);
                case "device.signChallenge":
                    return p.Count == 2 && HasOnly(p, "challengeId", "message")
                        && Text(p, "challengeId", 36) && Text(p, "message", 512);
                case "asset.download":
                case "library.importOptions":
                    return p.Count == 1 && HasOnly(p, "modelId") && Text(p, "modelId", 36) && ModelUuid.IsMatch((string)p["modelId"]);
                case "asset.import":
                    return HasOnly(p, "modelId", "optionId") && Text(p, "modelId", 36) && ModelUuid.IsMatch((string)p["modelId"])
                        && (!p.ContainsKey("optionId") || (Text(p, "optionId", 64) && Regex.IsMatch((string)p["optionId"], @"\A[0-9a-f]{64}\z")));
                case "scene.createBox":
                    return HasOnly(p, "size") && Number(p, "size", 1, 10000);
                case "design.create":
                    return HasOnly(p, "type", "width", "depth", "height", "shelves", "r", "g", "b")
                        && Text(p, "type", 16) && new[] { "desk", "chair", "shelf", "sofa" }.Contains((string)p["type"])
                        && Number(p, "width", 1, 10000) && Number(p, "depth", 1, 10000) && Number(p, "height", 1, 10000)
                        && Number(p, "shelves", 1, 20) && Number(p, "r", 0, 255) && Number(p, "g", 0, 255) && Number(p, "b", 0, 255);
                default: return p.Count == 0;
            }
        }

        private static bool HasOnly(Dictionary<string, object> p, params string[] names)
        {
            return p.Keys.All(names.Contains);
        }
        private static bool Text(Dictionary<string, object> p, string name, int max)
        {
            object value;
            return p.TryGetValue(name, out value) && value is string && ((string)value).Length > 0
                && ((string)value).Length <= max && !((string)value).Any(char.IsControl);
        }
        private static bool Number(Dictionary<string, object> p, string name, double min, double max)
        {
            object value;
            if (!p.TryGetValue(name, out value)) return true; // Preserve native adapter defaults.
            if (!(value is int || value is long || value is decimal || value is double)) return false;
            var number = Convert.ToDouble(value);
            return !double.IsNaN(number) && !double.IsInfinity(number) && number >= min && number <= max;
        }
    }
}
