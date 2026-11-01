using System;
using System.IO;
using System.Web.Script.Serialization;
using System.Security.Cryptography;

namespace MaxWebViewHost
{
    public sealed class PluginConfiguration
    {
        public Uri ApiBaseUri { get; private set; }
        public string AppDirectory { get; private set; }
        public bool IsOfflineLibrary { get; private set; }
        public string LibraryDirectory { get; private set; }
        public string LicensePublicKeyXml { get; private set; }
        /// <summary>v3 online mode (apiBaseUrl, no bundled library): catalog, previews and downloads come from the API with a device token.</summary>
        public bool IsV3Online { get { return !IsOfflineLibrary; } }
        /// <summary>Preview images shipped by the installer (seed\), copied once into the preview cache on the first run.</summary>
        public string SeedDirectory { get; private set; }
        private sealed class Settings
        {
            public string apiBaseUrl { get; set; }
            public bool allowLoopbackForTesting { get; set; }
            public string catalogUrl { get; set; }
            public string licensePublicKeyXml { get; set; }
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
                if (settings != null && (settings.catalogUrl != null || settings.licensePublicKeyXml != null))
                {
                    var library = Path.Combine(Path.GetFullPath(directory), "library");
                    if (!File.Exists(Path.Combine(library, "catalog.json")))
                        throw new InvalidDataException("Bộ cài thiếu thư viện. Hãy cài lại phiên bản đầy đủ.");
                    if (string.IsNullOrWhiteSpace(settings.licensePublicKeyXml) || settings.licensePublicKeyXml.Length > 8192)
                        throw new InvalidDataException("Bộ cài thiếu khóa công khai xác minh license.");
                    using (var rsa = new RSACryptoServiceProvider())
                    {
                        rsa.PersistKeyInCsp = false;
                        rsa.FromXmlString(settings.licensePublicKeyXml);
                        if (!rsa.PublicOnly || rsa.KeySize < 2048 || rsa.KeySize > 4096)
                            throw new InvalidDataException("Bộ cài chỉ được chứa khóa công khai RSA 2048–4096 bit.");
                    }
                    return new PluginConfiguration { IsOfflineLibrary = true, LibraryDirectory = library,
                        LicensePublicKeyXml = settings.licensePublicKeyXml, AppDirectory = app };
                }
                Uri api;
                if (settings == null || !Uri.TryCreate(settings.apiBaseUrl, UriKind.Absolute, out api)
                    || !string.IsNullOrEmpty(api.UserInfo) || api.AbsolutePath != "/"
                    || !string.IsNullOrEmpty(api.Query) || !string.IsNullOrEmpty(api.Fragment)
                    || (api.IsLoopback && !settings.allowLoopbackForTesting)
                    || (api.Scheme != "https" && !(settings.allowLoopbackForTesting && api.Scheme == "http" && api.IsLoopback)))
                    throw new InvalidDataException("Địa chỉ máy chủ không hợp lệ. Bộ cài phát hành phải dùng HTTPS.");
                return new PluginConfiguration { ApiBaseUri = api, AppDirectory = app, SeedDirectory = Path.Combine(Path.GetFullPath(directory), "seed") };
            }
            catch (ArgumentException) { throw new InvalidDataException("Cấu hình plugin không hợp lệ. Hãy cài lại phiên bản đầy đủ."); }
            catch (InvalidOperationException) { throw new InvalidDataException("Cấu hình plugin không hợp lệ. Hãy cài lại phiên bản đầy đủ."); }
            catch (CryptographicException) { throw new InvalidDataException("Khóa công khai xác minh license không hợp lệ."); }
            catch (System.Xml.XmlException) { throw new InvalidDataException("Khóa công khai xác minh license không hợp lệ."); }
            catch (System.Security.XmlSyntaxException) { throw new InvalidDataException("Khóa công khai xác minh license không hợp lệ."); }
        }
    }
}
