import React, { useEffect, useState } from "react";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { useAuth } from "../../Contexts/AuthContext"; // chỉnh đường dẫn nếu khác

// Hàng field tái sử dụng – KHÔNG đọc trực tiếp user[field] để tránh crash
function FieldRow({
  field,
  label,
  value,
  editing,
  draft,
  setDraft,
  startEdit,
  saveEdit,
  cancelEdit,
  saving,
}) {
  const isEditing = editing === field;

  return (
    <div className="grid grid-cols-12 items-center gap-3 py-4 border-b border-zinc-800/70 last:border-none">
      <div className="col-span-12 md:col-span-3 text-zinc-300 font-codec">
        {label} :
      </div>

      <div className="col-span-10 md:col-span-8 text-white/95 font-codec">
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-lg bg-black/40 border border-zinc-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600/60"
          />
        ) : value ? (
          <span className="break-words font-codec">{value}</span>
        ) : (
          <span className="text-zinc-500 italic font-source">Chưa cập nhật</span>
        )}
      </div>

      <div className="col-span-2 md:col-span-1 flex justify-end font-codec">
        {isEditing ? (
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              title="Lưu"
              disabled={saving}
              className="rounded-lg border border-green-700/50 bg-green-600/20 p-2 hover:bg-green-600/30 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            </button>
            <button
              onClick={cancelEdit}
              title="Hủy"
              disabled={saving}
              className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 hover:bg-zinc-700/60 disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => startEdit(field, value)}
            className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 hover:bg-zinc-700/60"
            title="Chỉnh sửa"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function InfoView() {
  const { user, refreshUser } = useAuth(); // lấy user + hàm refetch nếu có
  const API = import.meta.env.VITE_API_BASE_URL;
  const UPDATE_ENDPOINT = `${API}/api/account/users/me`; // đổi nếu backend khác

  // Local profile để hiển thị/soạn thảo an toàn
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
  });

  // Sync từ context user -> profile (chạy lại khi user thay đổi)
  useEffect(() => {
    setProfile({
      name: user?.name ?? user?.username ?? "",
      email: user?.email ?? "",
      phone: user?.phone ?? "",
      address: user?.address ?? "",
    });
  }, [user?.name, user?.username, user?.email, user?.phone, user?.address]);

  const [editing, setEditing] = useState(null); // tên field đang sửa
  const [draft, setDraft] = useState("");       // giá trị đang gõ
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEdit = (field, currentValue = "") => {
    setEditing(field);
    setDraft(currentValue ?? "");
    setError("");
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
    setError("");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError("");

    try {
      const token =
        user?.token ||
        localStorage.getItem("token") ||
        localStorage.getItem("accessToken");

      const body = { [editing]: draft };

      const res = await fetch(UPDATE_ENDPOINT, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include", // nếu dùng cookie httpOnly
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Cập nhật thất bại");
      }

      // Cập nhật UI ngay
      setProfile((p) => ({ ...p, [editing]: draft }));
      setEditing(null);
      setDraft("");

      // Đồng bộ lại context (nếu có)
      if (typeof refreshUser === "function") {
        await refreshUser();
      }
    } catch (e) {
      setError(e?.message || "Có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  // Guard khi chưa đăng nhập
  if (!user) {
    return (
      <>
        <h2 className="text-lg md:text-xl text-white font-source">Vui lòng đăng nhập</h2>
        <div className="h-px w-full bg-[#2D2D2D] mt-4" />
      </>
    );
  }

  return (
    <>
      <h2 className="text-lg md:text-xl text-white font-source">
        Xin chào {profile.name || "bạn"}!
      </h2>

      <div className="h-px w-full bg-[#2D2D2D] mt-4 font-codec" />

      {error && (
        <div className="mt-3 rounded-lg border border-red-800/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-2 font-codec">
        <FieldRow
          field="name"
          label="Tên tài khoản"
          value={profile.name}
          {...{ editing, draft, setDraft, startEdit, saveEdit, cancelEdit, saving }}
        />
        <FieldRow
          field="email"
          label="Email"
          value={profile.email}
          {...{ editing, draft, setDraft, startEdit, saveEdit, cancelEdit, saving }}
        />
        <FieldRow
          field="phone"
          label="Số điện thoại"
          value={profile.phone}
          {...{ editing, draft, setDraft, startEdit, saveEdit, cancelEdit, saving }}
        />
        <FieldRow
          field="address"
          label="Địa chỉ"
          value={profile.address}
          {...{ editing, draft, setDraft, startEdit, saveEdit, cancelEdit, saving }}
        />
      </div>
    </>
  );
}
