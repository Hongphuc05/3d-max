import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../Contexts/AuthContext";

// Dùng làm "vỏ" cho các route yêu cầu đăng nhập
export default function ProtectedRoute({ redirectTo = "/login" }) {
  const { user, token } = useAuth();
  const location = useLocation();

  // Xem như đăng nhập nếu đã có user hoặc còn token (đã lưu localStorage)
  const isAuthenticated = !!user || !!token;

  if (!isAuthenticated) {
    return (
      <Navigate
        to={redirectTo}
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <Outlet />;
}
