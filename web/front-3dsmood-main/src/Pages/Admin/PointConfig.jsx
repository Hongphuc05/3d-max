import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaSave, FaSync, FaInfoCircle } from "react-icons/fa";
import Sidebar from "../Admin/Sidebar/Sidebar";
// import Header from "../Admin/Header/Header";

const nf = new Intl.NumberFormat("vi-VN");

export default function PointConfig() {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const navigate = useNavigate();

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      throw new Error("NO_AUTH");
    }
    return { Authorization: `Bearer ${token}` };
  };

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ====== SERVER SNAPSHOT ======
  const [serverRatePay, setServerRatePay] = useState(15000);     // coins / 1 điểm (thanh toán)
  const [serverRateEarn, setServerRateEarn] = useState(15000);   // coins / 1 điểm (tích điểm)
  const [serverEarnFixed, setServerEarnFixed] = useState(10);    // điểm/sp khi trả coins (cố định)

  // ====== LOCAL (FORM) ======
  const [ratePay, setRatePay] = useState(15000);
  const [rateEarn, setRateEarn] = useState(15000);
  const [earnFixed, setEarnFixed] = useState(10);

  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  // ====== CALC DEMO ======
  const [coinAmount, setCoinAmount] = useState(150000);   // coins phải trả => tính điểm cần (ratePay)
  const [pointsAmount, setPointsAmount] = useState(10);   // điểm dùng => quy đổi về coins (ratePay)

  const [coinsSpent, setCoinsSpent] = useState(150000);   // coins chi khi trả coins => tính điểm thưởng (rateEarn)
  const [chargeCount, setChargeCount] = useState(3);      // số sản phẩm tính phí => tính điểm thưởng cố định/sp

  // Quy đổi thanh toán bằng điểm (dựa trên pointRatePay)
  const requiredPoints = useMemo(
    () => (ratePay > 0 ? Math.ceil((Number(coinAmount) || 0) / ratePay) : 0),
    [coinAmount, ratePay]
  );
  const coinsFromPoints = useMemo(
    () => (Number(pointsAmount) || 0) * (Number(ratePay) || 0),
    [pointsAmount, ratePay]
  );

  // Tích điểm khi trả coins
  const earnedByRate = useMemo(
    () => (rateEarn > 0 ? Math.floor((Number(coinsSpent) || 0) / rateEarn) : 0),
    [coinsSpent, rateEarn]
  );
  const earnedByFixed = useMemo(
    () => Math.max(0, Number(earnFixed) || 0) * Math.max(0, Number(chargeCount) || 0),
    [earnFixed, chargeCount]
  );

  // ====== API ======
  const fetchConfig = async () => {
    setLoading(true);
    setOk("");
    setErr("");
    try {
      const res = await axios.get(`${API}/api/payments/config`, {
        headers: getAuthHeaders(),
      });

      // Hỗ trợ cả khoá mới và khoá cũ để tương thích:
      const legacy = Number(res?.data?.pointRate); // có thể là tỉ lệ dùng chung (cũ)
      const pPay = Number(res?.data?.pointRatePay);
      const pEarn = Number(res?.data?.pointRateEarn);
      const fixed = Number(res?.data?.earnPerProductCoins);

      const vRatePay = !Number.isNaN(pPay) && pPay > 0
        ? pPay
        : (!Number.isNaN(legacy) && legacy > 0 ? legacy : 15000);
      const vRateEarn = !Number.isNaN(pEarn) && pEarn > 0
        ? pEarn
        : (!Number.isNaN(legacy) && legacy > 0 ? legacy : 15000);
      const vEarnFixed = !Number.isNaN(fixed) && fixed >= 0 ? fixed : 10;

      setServerRatePay(vRatePay);
      setServerRateEarn(vRateEarn);
      setServerEarnFixed(vEarnFixed);

      setRatePay(vRatePay);
      setRateEarn(vRateEarn);
      setEarnFixed(vEarnFixed);
    } catch (e) {
      if (e?.response?.status === 403) setErr("Bạn không có quyền cập nhật (admin only).");
      else if (e.message !== "NO_AUTH")
        setErr(e?.response?.data?.message || "Không lấy được cấu hình.");
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setOk("");
    setErr("");
    try {
      const body = {};
      if (Number(ratePay) !== Number(serverRatePay)) body.pointRatePay = Number(ratePay);
      if (Number(rateEarn) !== Number(serverRateEarn)) body.pointRateEarn = Number(rateEarn);
      if (Number(earnFixed) !== Number(serverEarnFixed)) body.earnPerProductCoins = Number(earnFixed);

      if (!Object.keys(body).length) {
        setOk("Không có thay đổi.");
        setSaving(false);
        return;
      }

      const res = await axios.put(`${API}/api/payments/config`, body, {
        headers: getAuthHeaders(),
      });

      // Cập nhật snapshot theo response (fallback sang form nếu API không trả lại đủ)
      const rPay = Number(res?.data?.pointRatePay);
      const rEarn = Number(res?.data?.pointRateEarn);
      const rFixed = Number(res?.data?.earnPerProductCoins);

      setServerRatePay(!Number.isNaN(rPay) && rPay > 0 ? rPay : Number(ratePay));
      setServerRateEarn(!Number.isNaN(rEarn) && rEarn > 0 ? rEarn : Number(rateEarn));
      setServerEarnFixed(!Number.isNaN(rFixed) && rFixed >= 0 ? rFixed : Number(earnFixed));

      setOk("Đã lưu cấu hình.");
    } catch (e) {
      if (e?.response?.status === 403) setErr("Bạn không có quyền cập nhật (admin only).");
      else if (e.message !== "NO_AUTH")
        setErr(e?.response?.data?.message || "Lưu cấu hình thất bại.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    Number(ratePay) !== Number(serverRatePay) ||
    Number(rateEarn) !== Number(serverRateEarn) ||
    Number(earnFixed) !== Number(serverEarnFixed);

  const disabled =
    saving || loading || !dirty || !(Number(ratePay) > 0) || !(Number(rateEarn) > 0) || !(Number(earnFixed) >= 0);

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
        {/* <Header /> */}
        <div className="p-6">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-200">
              <h1 className="text-lg font-semibold">Quản lý quy đổi & thưởng điểm</h1>
              <button
                onClick={fetchConfig}
                className="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                disabled={loading}
                title="Tải lại"
              >
                <FaSync className={loading ? "animate-spin" : ""} /> <span>Refresh</span>
              </button>
            </div>

            <div className="p-4 space-y-6">
              {/* Info line */}
              <div className="space-y-2">
                <div className="text-sm text-slate-700 flex items-center gap-2">
                  <FaInfoCircle className="text-slate-500" />
                  <span className="space-x-2">
                    <span>
                      <b className="text-slate-900">Thanh toán bằng điểm</b>: 1 điểm ={" "}
                      <b className="text-slate-900">{nf.format(serverRatePay)}</b> coins
                    </span>
                    <span className="inline-block">•</span>
                    <span>
                      <b className="text-slate-900">Tích điểm khi trả coins</b>: 1 điểm /{" "}
                      <b className="text-slate-900">{nf.format(serverRateEarn)}</b> coins
                    </span>
                    <span className="inline-block">•</span>
                    <span>
                      <b className="text-slate-900">Thưởng cố định</b>:{" "}
                      <b className="text-slate-900">{serverEarnFixed}</b> điểm / sản phẩm
                    </span>
                  </span>
                </div>

                {/* Inputs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">
                      Tỉ lệ <b>thanh toán bằng điểm</b> (coins / 1 điểm)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={100}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={ratePay}
                      onChange={(e) => setRatePay(Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-600 mt-1">
                      1 điểm = <b className="text-slate-900">{nf.format(ratePay || 0)}</b> coins
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm text-slate-600 mb-1">
                      Tỉ lệ <b>tích điểm khi trả coins</b> (coins / 1 điểm)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={100}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={rateEarn}
                      onChange={(e) => setRateEarn(Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-600 mt-1">
                      Điểm thưởng = <i>floor(coins chi / tỉ lệ)</i>
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm text-slate-600 mb-1">
                      Điểm thưởng <b>cố định</b> / sản phẩm (khi trả coins)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={earnFixed}
                      onChange={(e) => setEarnFixed(Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-600 mt-1">
                      Tuỳ BE: có thể dùng cơ chế cố định, cơ chế theo tỉ lệ, hoặc kết hợp.
                    </p>
                  </div>
                </div>

                <div className="mt-2">
                  <button
                    onClick={saveConfig}
                    disabled={disabled}
                    className={`flex items-center gap-2 px-4 py-2 rounded border transition ${
                      disabled
                        ? "opacity-60 bg-gray-200 text-gray-600 border-gray-200"
                        : "bg-[#8f120d] hover:bg-[#a91410] text-white border-transparent"
                    }`}
                  >
                    <FaSave /> <span>Lưu cấu hình</span>
                  </button>
                </div>

                {ok && <div className="text-emerald-600 text-sm">{ok}</div>}
                {err && <div className="text-red-600 text-sm">{err}</div>}
              </div>

              {/* Calculator */}
              <div className="border-t border-gray-200 pt-4">
                <h2 className="text-base font-semibold mb-3">Calculator</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Pay with points */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <label className="block text-sm text-slate-600 mb-1">Coins phải trả (thanh toán bằng điểm)</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={coinAmount}
                      onChange={(e) => setCoinAmount(Number(e.target.value))}
                    />
                    <p className="text-sm text-slate-700 mt-2">
                      ≈ <b className="text-slate-900">{nf.format(requiredPoints)}</b> điểm @{" "}
                      {nf.format(ratePay)} coins/điểm
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <label className="block text-sm text-slate-600 mb-1">Số điểm dùng (thanh toán)</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={pointsAmount}
                      onChange={(e) => setPointsAmount(Number(e.target.value))}
                    />
                    <p className="text-sm text-slate-700 mt-2">
                      Quy đổi: <b className="text-slate-900">{nf.format(coinsFromPoints)}</b> coins @{" "}
                      {nf.format(ratePay)} coins/điểm
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {/* Earn by rate */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <label className="block text-sm text-slate-600 mb-1">Coins chi (khi trả coins)</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={coinsSpent}
                      onChange={(e) => setCoinsSpent(Number(e.target.value))}
                    />
                    <p className="text-sm text-slate-700 mt-2">
                      Điểm thưởng (theo <b>tỉ lệ</b>):{" "}
                      <b className="text-slate-900">{nf.format(earnedByRate)}</b> điểm @{" "}
                      {nf.format(rateEarn)} coins/điểm
                    </p>
                  </div>

                  {/* Earn fixed per product */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <label className="block text-sm text-slate-600 mb-1">
                      Số sản phẩm tính phí (trả coins)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-[#8f120d]"
                      value={chargeCount}
                      onChange={(e) => setChargeCount(Number(e.target.value))}
                    />
                    <p className="text-sm text-slate-700 mt-2">
                      Điểm thưởng (theo <b>cố định</b>):{" "}
                      <b className="text-slate-900">{nf.format(earnedByFixed)}</b> điểm{" "}
                      <span className="text-slate-600">
                        ({nf.format(earnFixed)} đ/ sp × {nf.format(chargeCount)} sp)
                      </span>
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 mt-3">
                  • Thanh toán bằng điểm: điểm cần = <i>ceil(coins phải trả / tỉ lệ thanh toán)</i>.<br />
                  • Tích điểm khi trả coins: điểm thưởng = <i>floor(coins chi / tỉ lệ tích điểm)</i> <b>hoặc</b>{" "}
                  <i>điểm cố định × số sản phẩm</i> (tuỳ cách áp dụng ở backend).
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
