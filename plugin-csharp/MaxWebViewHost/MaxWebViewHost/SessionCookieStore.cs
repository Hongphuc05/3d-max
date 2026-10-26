using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace MaxWebViewHost
{
    internal sealed class StoredSessionCookie
    {
        public string Name { get; set; }
        public string Value { get; set; }
        public DateTime ExpiresUtc { get; set; }
    }

    // Durable user-scoped session storage. No password or private device key enters this file.
    // The endpoint is part of both its filename and DPAPI entropy, preventing cross-server reuse.
    internal sealed class SessionCookieStore
    {
        private readonly string directory;
        private readonly string file;
        private readonly byte[] entropy;
        private readonly string mutexName;
        private readonly Uri backend;
        internal SessionCookieStore(string directory, Uri backend)
        {
            this.directory = directory;
            this.backend = backend;
            entropy = Encoding.UTF8.GetBytes("3DsMood.Sessions.v1|" + backend.GetLeftPart(UriPartial.Authority));
            string hash;
            using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(entropy)).Replace("-", "");
            file = Path.Combine(directory, hash + ".dat");
            mutexName = "Local\\3DsMood.Sessions." + hash;
        }

        internal List<StoredSessionCookie> Load() { return Locked(Read); }
        internal void Apply(IEnumerable<string> headers)
        {
            Locked(() =>
            {
                var current = Read().ToDictionary(c => c.Name, StringComparer.Ordinal);
                foreach (var header in headers)
                {
                    if (header == null || header.Length > 16384) continue;
                    var first = header.Split(';')[0];
                    var equals = first.IndexOf('=');
                    if (equals < 1) continue;
                    var name = first.Substring(0, equals).Trim();
                    if (name != "sid" && name != "dsid") continue;
                    try
                    {
                        var container = new CookieContainer();
                        container.SetCookies(backend, header);
                        var cookies = container.GetCookies(backend).Cast<Cookie>().ToArray();
                        var cookie = cookies.FirstOrDefault(c => c.Name == name);
                        if (cookie == null || cookie.Expired || string.IsNullOrEmpty(cookie.Value)) current.Remove(name);
                        else current[name] = new StoredSessionCookie { Name = name, Value = cookie.Value,
                            ExpiresUtc = cookie.Expires == DateTime.MinValue ? DateTime.UtcNow.AddDays(30) : cookie.Expires.ToUniversalTime() };
                    }
                    catch (CookieException) { }
                }
                Write(current.Values.ToList());
                return true;
            });
        }

        private List<StoredSessionCookie> Read()
        {
            if (!File.Exists(file)) return new List<StoredSessionCookie>();
            byte[] clear = null;
            try
            {
                if (new FileInfo(file).Length > 65536) return new List<StoredSessionCookie>();
                clear = ProtectedData.Unprotect(File.ReadAllBytes(file), entropy, DataProtectionScope.CurrentUser);
                return (new JavaScriptSerializer().Deserialize<List<StoredSessionCookie>>(Encoding.UTF8.GetString(clear))
                    ?? new List<StoredSessionCookie>()).Where(c => c != null && (c.Name == "sid" || c.Name == "dsid")
                    && c.Value != null && c.Value.Length <= 16384 && c.ExpiresUtc > DateTime.UtcNow).ToList();
            }
            catch (CryptographicException) { return new List<StoredSessionCookie>(); }
            catch (ArgumentException) { return new List<StoredSessionCookie>(); }
            finally { if (clear != null) Array.Clear(clear, 0, clear.Length); }
        }

        private void Write(List<StoredSessionCookie> cookies)
        {
            if (!Directory.Exists(directory))
            {
                var security = new DirectorySecurity();
                security.SetAccessRuleProtection(true, false);
                security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,
                    FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
                Directory.CreateDirectory(directory, security);
            }
            var clear = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(cookies));
            byte[] encrypted;
            try { encrypted = ProtectedData.Protect(clear, entropy, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(clear, 0, clear.Length); }
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                stream.Write(encrypted, 0, encrypted.Length);
            if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
        }

        private T Locked<T>(Func<T> operation)
        {
            using (var mutex = new Mutex(false, mutexName))
            {
                var acquired = false;
                try
                {
                    try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(10)); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) throw new IOException("Session storage is busy.");
                    return operation();
                }
                finally { if (acquired) mutex.ReleaseMutex(); }
            }
        }
    }
}
