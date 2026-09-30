import React, { useState } from "react";
import { FaGoogle, FaFacebookF, FaEye } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Header from "../../Components/header";
import { useAuth } from "../../Contexts/AuthContext"; // optional

const SignupForm = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const navigate = useNavigate();
  const { login } = useAuth(); // nếu chưa có thì bỏ dòng này

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (form.password !== form.confirmPassword) {
      alert("Passwords do not match!");
      return;
    }

    try {
      const res = await axios.post(`${API_BASE_URL}/api/auth/register`, {
        username: form.username,
        email: form.email,
        password: form.password,
      });

      const { user, token } = res.data;

      login(user, token); // nếu có context

      navigate("/");
    } catch (err) {
      console.error("Register error:", err);
      alert(err.response?.data?.message || "Registration failed.");
    }
  };

  return (
    <div>
      <Header />
      <div className="w-screen h-screen flex items-center justify-center bg-[url('/back.svg')] bg-cover bg-center border border-[#2D2D2D]">
        <div className="w-full max-w-md bg-[rgba(28,28,28,0.45)] rounded-xl text-white">
          <h2 className="text-xl font-codec text-center my-4">Sign Up</h2>
          <div className="h-px bg-[#1e1d1e]"></div>
          <div className="px-4">
            {/* Social login */}
            <div className="flex items-center justify-between space-x-4 my-4">
              <button className="flex-1 bg-[#1a1515] text-[#989696] py-2 rounded flex items-center justify-center gap-2 text-sm hover:opacity-90 border border-[#241f1f] font-codec">
                <img src="/gg.svg" alt="Google" className="w-6 h-6" />
                Google
              </button>
              <button className="flex-1 h-10 bg-[#1a1515] rounded flex items-center justify-center gap-2 text-sm hover:opacity-90 border border-[#241f1f] text-[#989696] font-codec">
                <img src="/fb.svg" alt="Facebook" className="h-7 w-7 object-contain" />
                Facebook
              </button>
            </div>

            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Enter Username"
              className="w-full px-4 py-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white my-2 font-codec"
            />

            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Enter Email"
              className="w-full px-4 py-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white mb-2 font-codec"
            />

            <div className="relative">
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Enter password"
                className="w-full px-4 py-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white font-codec"
              />
              <FaEye className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 cursor-pointer" />
            </div>

            <div className="relative">
              <input
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Enter password again"
                className="w-full px-4 py-2 mt-2 rounded placeholder:text-[#989696] bg-neutral-900 border border-[#241f1f] text-sm focus:outline-none focus:ring-1 focus:ring-white font-codec"
              />
              <FaEye className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 cursor-pointer" />
            </div>

            <div className="text-center text-[10px] text-[#989696] font-codec my-2">
              By clicking "Sign Up" you agree to The Terms of Use for Custome
            </div>
          </div>

          <div className="h-px bg-[#1e1d1e]"></div>

          <button
            onClick={handleSubmit}
            className="block px-8 py-1 bg-[#8f120d] rounded text-white font-codec hover:bg-[#a01e1e] transition text-center mx-auto mt-4"
          >
            Sign Up
          </button>

          <div className="text-center text-sm text-[#989696] font-codec mt-4 pb-6">
            Already have an account?{" "}
            <span
              className="hover:underline cursor-pointer text-[#989696]"
              onClick={() => navigate("/login")}
            >
              Login
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupForm;
