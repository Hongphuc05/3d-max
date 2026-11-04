using System;
using System.IO;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    public sealed class PluginConfiguration
    {
        public Uri ApiBaseUri { get; private set; }
        public string AppDirectory { get; private set; }
        private sealed class Settings
        {
            public string apiBaseUrl { get; set; }
            public bool allowLoopbackForTesting { get; set; }
        }

        public static PluginConfiguration Load(string directory)
        {
            try
            {
                var file = Path.Combine(directory, "plugin-config.json");
                if (!File.Exists(file) || new FileInfo(file).Length > 16384)
                    throw new InvalidDataException("Bộ cài chưa được cấu hình địa chỉ máy chủ. Liên hệ nhà cung cấp để nhận bộ cài đúng.");
                var settings = new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(file));
                var app = Path.Combine(Path.GetFullPath(directory), "app");
                if (!File.Exists(Path.Combine(app, "index.html"))) throw new InvalidDataException("Bộ cài thiếu giao diện. Hãy cài lại phiên bản đầy đủ.");
                Uri api;
                if (settings == null || !Uri.TryCreate(settings.apiBaseUrl, UriKind.Absolute, out api)
                    || !string.IsNullOrEmpty(api.UserInfo) || api.AbsolutePath != "/"
                    || !string.IsNullOrEmpty(api.Query) || !string.IsNullOrEmpty(api.Fragment)
                    || (api.IsLoopback && !settings.allowLoopbackForTesting)
                    || (api.Scheme != "https" && !(settings.allowLoopbackForTesting && api.Scheme == "http" && api.IsLoopback)))
                    throw new InvalidDataException("Địa chỉ máy chủ không hợp lệ. Bộ cài phát hành phải dùng HTTPS.");
                return new PluginConfiguration { ApiBaseUri = api, AppDirectory = app };
            }
            catch (ArgumentException) { throw new InvalidDataException("Cấu hình plugin không hợp lệ. Hãy cài lại phiên bản đầy đủ."); }
            catch (InvalidOperationException) { throw new InvalidDataException("Cấu hình plugin không hợp lệ. Hãy cài lại phiên bản đầy đủ."); }
        }
    }
}
