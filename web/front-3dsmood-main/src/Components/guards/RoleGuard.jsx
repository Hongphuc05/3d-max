// RoleGuard.jsx (gợi ý tối thiểu)
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../Contexts/AuthContext";

export default function RoleGuard({ roles = [] }) {
  const { user, hydrated } = useAuth();
  const location = useLocation();

  if (!hydrated) return null; // hoặc loader

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (roles.length && !roles.includes(String(user.role).toLowerCase())) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
