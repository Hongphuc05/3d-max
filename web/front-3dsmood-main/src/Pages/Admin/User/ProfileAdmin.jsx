import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FaEye } from "react-icons/fa";
import { useAuth } from "../../../Contexts/AuthContext";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";

export default function AdminProfileAccount() {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const { user: ctxUser, refreshUser } = useAuth();

  // ------------ Utils ------------
  const buildUrl = (path) => {
    if (!path) return "/avatar-placeholder.png";
    if (/^https?:\/\//i.test(path)) return path;
    return `${API}/${String(path).replace(/^\/+/, "")}`;
  };
  const authHeaders = () => {
    const t = localStorage.getItem("token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  // ------------ State: profile ------------
  const [form, setForm] = useState({
    username: ctxUser?.username || "",
    email: ctxUser?.email || "",
    phone: ctxUser?.phone || "",
    address: ctxUser?.address || "",
    avatar: ctxUser?.avatar || "",
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [preview, setPreview] = useState(form.avatar ? buildUrl(form.avatar) : "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // {type:'success'|'error', text}

  useEffect(() => {
    if (!ctxUser) return;
    setForm((f) => ({
      ...f,
      username: ctxUser.username || "",
      email: ctxUser.email || "",
      phone: ctxUser.phone || "",
      address: ctxUser.address || "",
      avatar: ctxUser.avatar || "",
    }));
    setPreview(ctxUser.avatar ? buildUrl(ctxUser.avatar) : "");
  }, [ctxUser]);

  const v = useMemo(() => {
    const nameOK = (form.username || "").trim().length >= 3;
    const phoneOK = !form.phone || /[0-9+\-()\s]{6,}/.test(form.phone);
    return { nameOK, phoneOK, ok: nameOK && phoneOK };
  }, [form.username, form.phone]);

  const onChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const onSelectAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const uploadAvatarIfNeeded = async () => {
    if (!avatarFile) return form.avatar || "";
    const fd = new FormData();
    fd.append("file", avatarFile);
    try {
      const { data } = await axios.post(`${API}/api/uploads/avatar`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });
      return data?.url || "";
    } catch (e) {
      throw new Error(e?.response?.data?.message || "Tải ảnh đại diện thất bại");
    }
  };

  const onSaveProfile = async (e) => {
    e?.preventDefault();
    setMsg(null);
    if (!v.ok) return;
    setSaving(true);
    try {
      const avatarUrl = await uploadAvatarIfNeeded();
      const payload = {
        username: form.username.trim(),
        phone: form.phone || "",
        address: form.address || "",
        avatar: avatarUrl,
      };

      await axios.patch(`${API}/api/admin/users/update-profile`, payload, { headers: authHeaders() });

      setMsg({ type: "success", text: "Đã cập nhật thông tin tài khoản." });
      setAvatarFile(null);
      await refreshUser?.();
    } catch (e) {
      setMsg({ type: "error", text: e?.response?.data?.message || e.message || "Cập nhật thất bại" });
    } finally {
      setSaving(false);
    }
  };

  // ------------ State: password ------------
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showCfm, setShowCfm] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [msgPw, setMsgPw] = useState(null);

  const pwRules = useMemo(() => {
    const lengthOK = newPassword.length >= 8;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNum = /\d/.test(newPassword);
    const hasSym = /[^\w\s]/.test(newPassword);
    const notSameAsOld = !!newPassword && newPassword !== currentPassword;
    const matchCfm = !!newPassword && newPassword === confirmPassword;
    const score = [lengthOK, hasUpper, hasLower, hasNum, hasSym, notSameAsOld].filter(Boolean).length;
    let level = "Yếu";
    if (score >= 5) level = "Mạnh"; else if (score >= 3) level = "Trung bình";
    return { lengthOK, hasUpper, hasLower, hasNum, hasSym, notSameAsOld, matchCfm, score, level };
  }, [newPassword, confirmPassword, currentPassword]);

  const canSubmitPw =
    pwRules.lengthOK &&
    pwRules.hasUpper &&
    pwRules.hasLower &&
    pwRules.hasNum &&
    pwRules.hasSym &&
    pwRules.notSameAsOld &&
    pwRules.matchCfm &&
    currentPassword &&
    !savingPw;

  const onSavePassword = async (e) => {
    e?.preventDefault();
    setMsgPw(null);
    if (!canSubmitPw) return;
    setSavingPw(true);
    try {
      await axios.post(
        `${API}/api/admin/users/change-password`,
        { currentPassword, newPassword },
        { headers: authHeaders() }
      );
      setMsgPw({ type: "success", text: "Đổi mật khẩu thành công." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const msg = err?.response?.data?.message || "Đổi mật khẩu thất bại.";
      setMsgPw({ type: "error", text: msg });
    } finally {
      setSavingPw(false);
    }
  };

  // --- UI ---
  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
      <Sidebar activeKey="user" />
      <main className="flex-1 min-w-0 bg-white">
        <div className="p-4 md:p-6 max-w-7xl">
          <h1 className="text-2xl font-semibold mb-4 text-gray-900">Hồ sơ tài khoản</h1>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Card Avatar */}
            <div className="md:col-span-1 rounded-2xl border border-gray-200 bg-white text-gray-900 p-5">
              <h2 className="text-lg font-medium mb-4 text-gray-900">Ảnh đại diện</h2>
              <div className="flex flex-col items-center gap-4">
                <div className="h-32 w-32 rounded-full overflow-hidden border border-gray-200 bg-gray-100">
                  {preview ? (
                    <img src={preview} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">No Avatar</div>
                  )}
                </div>
                <label className="inline-block cursor-pointer px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm text-gray-700">
                  Chọn ảnh
                  <input type="file" accept="image/*" className="hidden" onChange={onSelectAvatar} />
                </label>
                {preview && (
                  <button
                    type="button"
                    onClick={() => { setAvatarFile(null); setPreview(""); setForm((f)=>({ ...f, avatar: "" })); }}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Gỡ ảnh hiện tại
                  </button>
                )}
              </div>
            </div>

            {/* Card Thông tin chung */}
            <form onSubmit={onSaveProfile} className="md:col-span-2 rounded-2xl border border-gray-200 bg-white text-gray-900 p-5">
              <h2 className="text-lg font-medium mb-4 text-gray-900">Thông tin tài khoản</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-1 text-gray-700">Username</label>
                  <input
                    name="username"
                    value={form.username}
                    onChange={onChange}
                    placeholder="Tên hiển thị"
                    className={`w-full rounded-lg bg-white border px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      v.nameOK ? 'border-gray-300' : 'border-red-500'
                    }`}
                    required
                  />
                  {!v.nameOK && <p className="text-xs text-red-600 mt-1">Tối thiểu 3 ký tự.</p>}
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700">Email</label>
                  <input
                    name="email"
                    value={form.email}
                    readOnly
                    className="w-full rounded-lg bg-gray-100 border border-gray-200 px-4 py-2 text-gray-500 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700">Số điện thoại</label>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={onChange}
                    placeholder="Ví dụ: 090..., +84...,"
                    className={`w-full rounded-lg bg-white border px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      v.phoneOK ? 'border-gray-300' : 'border-yellow-500'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700">Địa chỉ</label>
                  <input
                    name="address"
                    value={form.address}
                    onChange={onChange}
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    className="w-full rounded-lg bg-white border border-gray-300 px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mt-5">
                <button
                  type="submit"
                  disabled={!v.ok || saving}
                  className={`px-4 py-2 rounded-lg text-white transition ${
                    (!v.ok || saving) ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
                </button>
                {msg && (
                  <span className={msg.type === 'success' ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                    {msg.text}
                  </span>
                )}
              </div>

              {/* Info read-only */}
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-gray-600">
                <div className="rounded-lg border border-gray-200 p-3 bg-white">
                  <div className="text-gray-500">Coins</div>
                  <div className="text-gray-900 text-lg">{ctxUser?.coins ?? 0}</div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3 bg-white">
                  <div className="text-gray-500">Points</div>
                  <div className="text-gray-900 text-lg">{ctxUser?.points ?? 0}</div>
                </div>
              </div>
            </form>

            {/* Card Đổi mật khẩu */}
            <form onSubmit={onSavePassword} className="md:col-span-3 rounded-2xl border border-gray-200 bg-white text-gray-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-gray-900">Đổi mật khẩu</h2>
                <div className="text-xs text-gray-600">
                  Độ mạnh:{" "}
                  <span className={pwRules.score>=5? 'text-green-600' : pwRules.score>=3? 'text-yellow-600' : 'text-red-600'}>
                    {pwRules.level}
                  </span>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm mb-1 text-gray-700">Mật khẩu hiện tại</label>
                  <div className="relative">
                    <input
                      type={showCur ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Nhập mật khẩu hiện tại"
                      className="w-full rounded-lg bg-white border border-gray-300 px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                    <FaEye
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 cursor-pointer"
                      onClick={() => setShowCur(s=>!s)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700">Mật khẩu mới</label>
                  <div className="relative">
                    <input
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Tối thiểu 8 ký tự, gồm hoa, thường, số, ký tự đặc biệt"
                      className="w-full rounded-lg bg-white border border-gray-300 px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                    <FaEye
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 cursor-pointer"
                      onClick={() => setShowNew(s=>!s)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1 text-gray-700">Xác nhận mật khẩu mới</label>
                  <div className="relative">
                    <input
                      type={showCfm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu mới"
                      className={`w-full rounded-lg bg-white border px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        pwRules.matchCfm || !confirmPassword ? 'border-gray-300' : 'border-red-500'
                      }`}
                      required
                    />
                    <FaEye
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 cursor-pointer"
                      onClick={() => setShowCfm(s=>!s)}
                    />
                  </div>
                  {!pwRules.matchCfm && confirmPassword && (
                    <p className="text-xs text-red-600 mt-1">Mật khẩu xác nhận không khớp.</p>
                  )}
                </div>
              </div>

              {/* Strength bar */}
              <div className="mt-3">
                <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`${pwRules.score >= 5 ? 'bg-green-500' : pwRules.score >= 3 ? 'bg-yellow-500' : 'bg-red-500'} h-full`}
                    style={{ width: `${(pwRules.score / 6) * 100}%` }}
                  />
                </div>
                <ul className="text-xs text-gray-600 mt-1 list-disc pl-5 space-y-0.5">
                  <li className={pwRules.lengthOK ? 'text-green-600' : ''}>Ít nhất 8 ký tự</li>
                  <li className={pwRules.hasUpper ? 'text-green-600' : ''}>Chữ hoa (A–Z)</li>
                  <li className={pwRules.hasLower ? 'text-green-600' : ''}>Chữ thường (a–z)</li>
                  <li className={pwRules.hasNum ? 'text-green-600' : ''}>Số (0–9)</li>
                  <li className={pwRules.hasSym ? 'text-green-600' : ''}>Ký tự đặc biệt (!@#$…)</li>
                  <li className={pwRules.notSameAsOld ? 'text-green-600' : ''}>Khác mật khẩu cũ</li>
                </ul>
              </div>

              <div className="flex items-center gap-3 mt-5">
                <button
                  type="submit"
                  disabled={!canSubmitPw}
                  className={`px-4 py-2 rounded-lg text-white transition ${
                    canSubmitPw ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {savingPw ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
                </button>
                {msgPw && (
                  <span className={msgPw.type === 'success' ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                    {msgPw.text}
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
