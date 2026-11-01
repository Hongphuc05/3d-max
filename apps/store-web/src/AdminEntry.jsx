// Diem vao cua route /admin: dang nhap + (neu role ADMIN) AdminDashboard. Tai bang import dong de ban thu vien offline khong keo them.
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { LicenseProvider } from './license.jsx';

export default function AdminEntry() {
  return <AuthProvider><LicenseProvider><App /></LicenseProvider></AuthProvider>;
}
