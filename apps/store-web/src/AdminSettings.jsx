// P3.7 — man "Cai dat" cua admin: form cai dat (D25) + bang model. Tai khi mo muc nay.
import AdminModels from './AdminModels.jsx';
import AdminSettingsForm from './AdminSettingsForm.jsx';

export default function AdminSettings() {
  return <section className="space-y-5">
    <h2 className="text-xl font-bold">Cài đặt</h2>
    <AdminSettingsForm />
    <AdminModels />
  </section>;
}
