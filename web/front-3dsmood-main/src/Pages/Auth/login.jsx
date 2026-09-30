import React, { useState } from "react";
import { FaEye } from "react-icons/fa";
import Header from "../../Components/header";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../../Contexts/AuthContext";

export default function LoginForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleLogin = async (e) => {
    e?.preventDefault();
    const { email, password } = form;
    if (!email || !password) {
      alert("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }

    setLoading(true);
    try {
      // /login KHÔNG cần Authorization header
      const res = await axios.post(`${API_BASE_URL}/api/auth/login`, { email, password });
      const { user, token } = res.data || {};
      if (!token) throw new Error("Bad login response: missing token");

      // Lưu token vào context -> context sẽ gọi /api/auth/me để sync user
      await login(token);

      // Điều hướng mượt: ưu tiên đường dẫn bị chặn trước đó (from),
      // nếu là admin thì vào /admin, còn lại về /
      const from = location.state?.from;
      const dest = user?.role === "admin" ? "/admin" : (from || "/");
      navigate(dest, { replace: true });
    } catch (err) {
      console.error("Login error:", err);
      alert(err?.response?.data?.message || "Đăng nhập thất bại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Header />
      <div className="w-screen h-screen flex items-center justify-center bg-[url('/back.svg')] bg-cover bg-center">
        <form onSubmit={handleLogin} className="w-full max-w-md bg-[rgba(28,28,28,0.45)] rounded-xl text-white">
          <h2 className="text-xl font-codec text-center my-4">Login</h2>
          <div className="h-px bg-[#1e1d1e]" />

          <div className="px-4">
            {/* Social login */}
            <div className="flex items-center justify-between space-x-4 my-4">
              <button
                type="button"
                className="flex-1 bg-[#1a1515] text-[#989696] py-2 rounded flex items-center justify-center gap-2 text-sm hover:opacity-90 border border-[#241f1f] font-codec"
                onClick={() => { window.location.href = `${API_BASE_URL}/api/auth/google`; }}
              >
                <img src="/gg.svg" alt="Google" className="w-6 h-6" />
                Google
              </button>
              <button
                type="button"
                className="flex-1 h-10 bg-[#1a1515] rounded flex items-center justify-center gap-2 text-sm hover:opacity-90 border border-[#241f1f] text-[#989696] font-codec"
              >
                <img src="/fb.svg" alt="Facebook" className="h-7 w-7 object-contain" />
                Facebook
              </button>
            </div>

            {/* Email */}
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Enter Email"
              className="w-full px-4 py-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white my-2"
              autoComplete="email"
              required
            />

            {/* Password */}
            <div className="relative">
              <input
                name="password"
                type={showPw ? "text" : "password"}
                value={form.password}
                onChange={handleChange}
                placeholder="Enter password"
                className="w-full px-4 py-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white"
                autoComplete="current-password"
                required
              />
              <FaEye
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 cursor-pointer"
                onClick={() => setShowPw((s) => !s)}
                title={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              />
            </div>

            {/* Forgot password */}
            <div
              className="text-right text-sm text-[#989696] font-codec my-2 hover:underline cursor-pointer"
              onClick={() => navigate("/forgot-password")}
            >
              Forgot password?
            </div>
          </div>

          <div className="h-px bg-[#1e1d1e]" />

          {/* Login button */}
          <button
            type="submit"
            disabled={loading}
            className={`block px-8 py-1 rounded text-white font-codec transition text-center mx-auto mt-4 ${
              loading ? "bg-gray-500 cursor-not-allowed" : "bg-[#8f120d] hover:bg-[#a01e1e]"
            }`}
          >
            {loading ? "Đang đăng nhập..." : "Login"}
          </button>

          {/* Sign up */}
          <div className="text-center text-sm text-[#989696] font-codec mt-4 pb-6">
            Don’t have an account?{" "}
            <span className="hover:underline cursor-pointer" onClick={() => navigate("/signup")}>
              Sign Up
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
