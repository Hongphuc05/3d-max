// src/Pages/Admin/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from "recharts";
import Sidebar from "../Admin/Sidebar/Sidebar";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const TZ = "Asia/Bangkok";

// Vibrant, accessible palette (inspired by Tailwind hues)
const COLORS = {
  blue: "#2563EB",       // blue-600
  emerald: "#10B981",    // emerald-500
  amber: "#F59E0B",      // amber-500
  violet: "#8B5CF6",     // violet-500
  rose: "#F43F5E",       // rose-500
  cyan: "#06B6D4",       // cyan-500
  slate600: "#475569",
  grid: "#E5E7EB",       // gray-200
  bgTooltip: "#FFFFFF",
  bdTooltip: "#E5E7EB",
};

const PIE_SET = [COLORS.blue, COLORS.emerald, COLORS.amber, COLORS.violet, COLORS.rose, COLORS.cyan];

const nf = new Intl.NumberFormat("vi-VN");
const cf = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

function formatISODate(d) {
  const date = new Date(d);
  return date.toLocaleDateString("vi-VN", { timeZone: TZ });
}

// ===== Helpers để mặc định tuần hiện tại (Thứ 2 → Chủ nhật) & pad đủ ngày =====
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getCurrentWeekRangeMondayToSunday() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - dow);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(0, 0, 0, 0);

  return { from: ymdLocal(monday), to: ymdLocal(sunday) };
}

function padWeekDays(fromStr, toStr, rows, kind = "orders") {
  const toDate = new Date(toStr);
  const fromDate = new Date(fromStr);

  const map = new Map(
    (rows || []).map((r) => {
      const d = new Date(r.date);
      const key = ymdLocal(d);
      return [key, r];
    })
  );

  const out = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= toDate) {
    const key = ymdLocal(cursor);
    const found = map.get(key);
    if (found) {
      out.push(found);
    } else {
      if (kind === "users") {
        out.push({ date: new Date(cursor), users: 0 });
      } else {
        out.push({ date: new Date(cursor), orders: 0, revenue: 0, avg: 0 });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

async function fetchJSON(url, opts = {}) {
  const token = localStorage.getItem("token"); // Put your admin JWT here
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : undefined,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Dashboard() {
  const { from: weekFrom, to: weekTo } = getCurrentWeekRangeMondayToSunday();
  const [from, setFrom] = useState(weekFrom);
  const [to, setTo] = useState(weekTo);
  const [granularity, setGranularity] = useState("day");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [overview, setOverview] = useState(null);
  const [ordersTS, setOrdersTS] = useState([]);
  const [usersTS, setUsersTS] = useState([]);
  const [methods, setMethods] = useState([]);
  const [points, setPoints] = useState({ pointsUsed: 0, earnedPoints: 0 });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const q = `?from=${from}&to=${to}`;
      const [ov, oByDay, uByDay, pay, pts] = await Promise.all([
        fetchJSON(`${API}/api/admin/stats/overview${q}`),
        fetchJSON(`${API}/api/admin/stats/orders/by-day${q}&granularity=${granularity}`),
        fetchJSON(`${API}/api/admin/stats/users/by-day${q}&granularity=${granularity}`),
        fetchJSON(`${API}/api/admin/stats/orders/payment-methods${q}`),
        fetchJSON(`${API}/api/admin/stats/orders/points${q}`),
      ]);

      setOverview(ov);
      // Pad đủ Mon→Sun
      setOrdersTS(padWeekDays(from, to, oByDay.rows, "orders"));
      setUsersTS(padWeekDays(from, to, uByDay.rows, "users"));
      setMethods(pay.rows || []);
      setPoints({ pointsUsed: pts.pointsUsed || 0, earnedPoints: pts.earnedPoints || 0 });
    } catch (e) {
      console.error(e);
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // lần đầu vào: load tuần hiện tại

  function onApply() { load(); }

  const kpis = useMemo(() => {
    const totals = overview?.totals || {};
    const period = overview?.period || {};
    return [
      { label: "Tổng users", value: nf.format(totals.users || 0) },
      { label: "Đơn đã thanh toán", value: nf.format(totals.paidOrders || 0) },
      { label: "Tổng doanh thu", value: cf.format(totals.revenue || 0) },
      { label: "AOV (toàn bộ)", value: cf.format(totals.avgOrderValue || 0) },
      { label: "User mới (khoảng)", value: nf.format(period.newUsers || 0) },
      { label: "Đơn (khoảng)", value: nf.format(period.paidOrders || 0) },
      { label: "Doanh thu (khoảng)", value: cf.format(period.revenue || 0) },
      { label: "AOV (khoảng)", value: cf.format(period.avgOrderValue || 0) },
      { label: "Điểm đã dùng", value: nf.format(points.pointsUsed || 0) },
      { label: "Điểm thưởng", value: nf.format(points.earnedPoints || 0) },
    ];
  }, [overview, points]);

  // ===== Tooltip tùy biến cho Pie (hiển thị cả Revenue & PointsUsed & Orders)
  const PaymentTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const p = payload[0]?.payload || {};
      return (
        <div
          style={{
            background: COLORS.bgTooltip,
            border: `1px solid ${COLORS.bdTooltip}`,
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {p.method || "unknown"}
          </div>
          <div>Doanh thu: <b>{cf.format(p.revenue || 0)}</b></div>
          <div>Điểm đã dùng: <b>{nf.format(p.pointsUsed || 0)}</b></div>
          <div>Đơn: <b>{nf.format(p.orders || 0)}</b></div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
        <div className="min-h-screen bg-white text-gray-900">
          <div className="mx-auto max-w-[1400px] p-6 space-y-6">
            <header className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard — Users & Orders</h1>
            </header>

            {/* Filters */}
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Từ ngày</label>
                  <input
                    type="date"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                    className="border-gray-300 focus:border-gray-900 focus:ring-gray-900 w-44 rounded-lg border px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Đến ngày</label>
                  <input
                    type="date"
                    value={to}
                    onChange={e => setTo(e.target.value)}
                    className="border-gray-300 focus:border-gray-900 focus:ring-gray-900 w-44 rounded-lg border px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Granularity</label>
                  <select
                    value={granularity}
                    onChange={e => setGranularity(e.target.value)}
                    className="border-gray-300 focus:border-gray-900 focus:ring-gray-900 w-44 rounded-lg border px-3 py-2 outline-none bg-white"
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
                <button
                  onClick={onApply}
                  className="ml-auto rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50 active:bg-gray-100"
                >
                  Áp dụng
                </button>
              </div>
            </section>

            {/* KPIs */}
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {kpis.map((k, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow transition-shadow"
                >
                  <div className="text-xs text-gray-500">{k.label}</div>
                  <div className="mt-1 text-xl font-semibold">{k.value}</div>
                </div>
              ))}
            </section>

            {/* Charts */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="font-medium mb-3">Doanh thu & Đơn theo {granularity}</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ordersTS.map(r => ({ ...r, label: formatISODate(r.date) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis dataKey="label" stroke={COLORS.slate600} />
                      <YAxis yAxisId="left" stroke={COLORS.slate600} />
                      <YAxis yAxisId="right" orientation="right" stroke={COLORS.slate600} />
                      <Tooltip
                        formatter={(val, name) => name === "revenue" ? cf.format(val) : nf.format(val)}
                        contentStyle={{ background: COLORS.bgTooltip, border: `1px solid ${COLORS.bdTooltip}`, borderRadius: 8 }}
                        labelStyle={{ color: COLORS.slate600 }}
                      />
                      <Legend />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="orders"
                        name="Đơn"
                        stroke={COLORS.blue}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 5, strokeWidth: 2 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="revenue"
                        name="Doanh thu"
                        stroke={COLORS.emerald}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 5, strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="font-medium mb-3">User mới theo {granularity}</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usersTS.map(r => ({ ...r, label: formatISODate(r.date) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis dataKey="label" stroke={COLORS.slate600} />
                      <YAxis stroke={COLORS.slate600} />
                      <Tooltip
                        formatter={(val) => nf.format(val)}
                        contentStyle={{ background: COLORS.bgTooltip, border: `1px solid ${COLORS.bdTooltip}`, borderRadius: 8 }}
                        labelStyle={{ color: COLORS.slate600 }}
                      />
                      <Legend />
                      <Bar dataKey="users" name="User mới" fill={COLORS.violet} radius={[8,8,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="font-medium mb-3">Phương thức thanh toán</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={methods}
                        dataKey="revenue"        // lát cắt vẫn theo doanh thu (đã loại points khỏi doanh thu)
                        nameKey="method"
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                        // Nhãn hiển thị cả doanh thu + điểm đã dùng
                        label={({ payload }) =>
                          `${payload.method || 'unknown'}: ${cf.format(payload.revenue || 0)} • ${nf.format(payload.pointsUsed || 0)} điểm`
                        }
                      >
                        {methods.map((_, idx) => (
                          <Cell key={`c-${idx}`} fill={PIE_SET[idx % PIE_SET.length]} />
                        ))}
                      </Pie>
                      {/* Tooltip tùy biến để show Revenue + Points + Orders */}
                      <Tooltip content={<PaymentTooltip />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="font-medium mb-3">Điểm sử dụng & tích luỹ (khoảng)</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[points]}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis dataKey={() => "Points"} stroke={COLORS.slate600} />
                      <YAxis stroke={COLORS.slate600} />
                      <Tooltip
                        formatter={(val) => nf.format(val)}
                        contentStyle={{ background: COLORS.bgTooltip, border: `1px solid ${COLORS.bdTooltip}`, borderRadius: 8 }}
                        labelStyle={{ color: COLORS.slate600 }}
                      />
                      <Legend />
                      <Bar dataKey="pointsUsed" name="Điểm đã dùng" fill={COLORS.rose} radius={[8,8,0,0]} />
                      <Bar dataKey="earnedPoints" name="Điểm thưởng" fill={COLORS.amber} radius={[8,8,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Raw data (debug) */}
            {/* <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <details>
                <summary className="cursor-pointer font-medium">Raw JSON (debug)</summary>
                <pre className="mt-3 text-xs overflow-auto max-h-96">
{JSON.stringify({ overview, ordersTS, usersTS, methods, points }, null, 2)}
                </pre>
              </details>
            </section> */}
          </div>

          {loading && (
            <div className="fixed inset-0 bg-black/5 backdrop-blur-[1px] flex items-center justify-center text-gray-700">
              Loading…
            </div>
          )}
          {error && (
            <div className="fixed bottom-4 right-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-2 text-rose-700 shadow">
              {String(error)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
