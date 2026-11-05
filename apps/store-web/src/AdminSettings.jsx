// P3.7 — man "Cai dat" cua admin: form cai dat (D25); bang model nam o muc Model rieng. Tai khi mo muc nay.
import AdminSettingsForm from './AdminSettingsForm.jsx';
import AdminTelegramConnections from './AdminTelegramConnections.jsx';

export default function AdminSettings() {
  return <section className="space-y-5">
    <h2 className="text-xl font-bold">Cài đặt</h2>
    <AdminSettingsForm />
    <AdminTelegramConnections />
  </section>;
}
