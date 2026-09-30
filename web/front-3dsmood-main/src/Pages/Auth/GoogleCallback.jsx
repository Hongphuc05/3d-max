// src/pages/GoogleCallback.jsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../Contexts/AuthContext"; // dùng context

const GoogleCallback = () => {
  const navigate = useNavigate();
  const { login } = useAuth(); // nếu chưa dùng context thì bỏ login()

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const token = query.get("token");
  
    if (!token) return; // Đợi token có rồi mới xử lý tiếp
  
    const fetchUser = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
  
        const user = await res.json();
  
        if (!user || user.message) {
          alert("Xác thực Google lỗi.");
          navigate("/login");
          return;
        }
  
        if (login) login(user, token);
        else {
          localStorage.setItem("token", token);
          localStorage.setItem("user", JSON.stringify(user));
        }
  
        navigate("/");
      } catch (err) {
        console.error("Lỗi xác thực Google:", err);
        alert("Xác thực Google lỗi.");
        navigate("/login");
      }
    };
  
    fetchUser();
  }, [login, navigate]);
  

  return <div className="text-white text-center mt-20">Đang xác thực Google...</div>;
};

export default GoogleCallback;
