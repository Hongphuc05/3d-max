import React, { useState, useEffect, useMemo, useRef } from "react";
const nf = new Intl.NumberFormat("vi-VN");

export default function DepositView() {
  const API = useMemo(
    () => (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, ""),
    []
  );
  const authHeaders = () => {
    const t = localStorage.getItem("token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  const [packs, setPacks] = useState([]);
  const [qty, setQty] = useState([]);

  useEffect(() => {
    fetch(`${API}/api/deposit-packs?active=1&all=1`)
      .then((r) => r.json())
      .then((data) => {
        const items = data.items || data || [];
        setPacks(items);
        setQty(items.map(() => 1));
      })
      .catch(console.error);
  }, [API]);

  // state cho popup tóm tắt
  const [summary, setSummary] = useState(null); // { amount, discount, quantity, total, packIndex, pack }
  const [loading, setLoading] = useState(false);

  // state hiển thị QR sau khi "Thanh toán"
  const [payment, setPayment] = useState(null);
  // payment: { orderCode, total, currency, qrUrl, bank: { nameOrCode, accountNo, accountName }, status, paidAt? }
  const pollRef = useRef(null);

  const calcTotal = (amount, quantity, discount = 0) => {
    const d = Number(discount) || 0;
    return Math.round(Number(amount) * Number(quantity) * (1 - d / 100));
  };

  const pad2 = (n) => String(n).padStart(2, "0");

  const openSummary = (pack, i) => {
    const quantity = qty[i] || 1;
    const discount = pack.discount || 0;
    setSummary({
      amount: pack.amount,
      discount,
      quantity,
      total: calcTotal(pack.amount, quantity, discount),
      packIndex: i,
      pack,
    });
  };

  const closeSummary = () => setSummary(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollStatus = (orderCode) => {
    clearPoll();
    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/sepay/deposit/${encodeURIComponent(orderCode)}/status`);
        const d = await r.json();
        if (d?.status === "paid") {
          setPayment((p) => (p ? { ...p, status: "paid", paidAt: d.paidAt || new Date().toISOString() } : p));
          clearPoll();
        }
      } catch {}
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  };

  useEffect(() => () => clearPoll(), []);

  const handleCheckout = async () => {
    if (!summary || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/sepay/deposit/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          packId: summary.pack?.id || summary.pack?._id,
          quantity: summary.quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Khởi tạo đơn thất bại");

      setPayment({
        orderCode: data.orderCode,
        total: data.total,
        currency: data.currency || "VND",
        qrUrl: data.qrUrl,
        bank: data.bank || {},
        status: data.status || "pending",
      });

      // poll trạng thái
      pollStatus(data.orderCode);
    } catch (e) {
      alert(e.message || "Có lỗi khi tạo đơn.");
    } finally {
      setLoading(false);
    }
  };

  const closePayment = () => {
    clearPoll();
    setPayment(null);
  };

  // ====== Modal helpers: khoá cuộn nền + ESC để đóng ======
  useEffect(() => {
    if (payment) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (e) => {
        if (e.key === "Escape") closePayment();
      };
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener("keydown", onKey);
      };
    }
  }, [payment]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 font-codec">
        {packs.map((p, i) => (
          <div
            key={i}
            className="relative rounded-xl border border-[#4d4d4d] bg-[#000000] shadow-[inset_0_1px_0_rgba(255,255,255,.04)] p-4"
          >
            {p.discount ? (
              <div className="absolute right-3 top-2 text-red-600 font-extrabold text-lg select-none font-codec">
                {p.discount}%
              </div>
            ) : null}

            <div className="py-6 text-center">
              <div className="text-white text-2xl tracking-wide font-codec">
                {nf.format(p.amount)}
              </div>
              <span>{p.note}</span>
            </div>

            <div className="mt-3 flex items-center justify-between font-codec">
              <label className="flex items-center gap-2 text-sm text-zinc-300 font-source">
                <span>SL</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={qty[i]}
                  onChange={(e) => {
                    const v = Math.max(1, Number(e.target.value || 1));
                    setQty((q) => {
                      const next = [...q];
                      next[i] = v;
                      return next;
                    });
                  }}
                  className="w-12 rounded-md border border-[#4d4d4d] bg-black/40 px-1 py-1 text-center text-white outline-none focus:ring-1 focus:ring-red-600 font-codec"
                />
              </label>

              <button
                onClick={() => openSummary(p, i)}
                className="rounded-md border border-red-700/60 bg-[#8f120d] px-5 py-1 text-sm font-medium text-white font-codec hover:opacity-90"
              >
                Mua
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        {/* POPUP Tổng quan đơn nạp (giữ nguyên layout bạn đang có) */}
        {summary && (
          <div className="flex items-start justify-start mt-6">
            {/* content */}
            <div
              className="relative z-[1000] w-[340px] max-w-[92vw] p-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Tổng quan đơn nạp"
            >
              <h3 className="text-white xl:text-[1.3rem] 2xl:text-[1.6rem] mb-4 font-source">
                Tổng quan đơn nạp :
              </h3>

              <div className="space-y-6 text-sm">
                <div className="flex items-center justify-between">
                  <span className="xl:text-[1rem] xl:text-[1.2rem] font-source">Đơn :</span>
                  <span className="text-white xl:text-[1rem] xl:text-[1.2rem]">
                    {nf.format(summary.amount)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="xl:text-[1rem] xl:text-[1.2rem]">SL :</span>
                  <span className="text-white">{pad2(summary.quantity)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="xl:text-[1rem] xl:text-[1.2rem] font-source">Giảm giá :</span>
                  <span className="text-red-400 xl:text-[1rem] xl:text-[1.2rem]">
                    {summary.discount || 0}%
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="xl:text-[1rem] xl:text-[1.2rem] font-source">Tổng tiền :</span>
                  <span className="bg-[#8f120d] text-white px-3 py-1 rounded-md xl:text-[1rem] xl:text-[1.2rem]">
                    {nf.format(summary.total)}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                className="mt-5 w-full rounded-md bg-[#76a23b] hover:opacity-90 text-white xl:text-[1.2rem] 2xl:text-[1.4rem] py-2"
                disabled={loading}
              >
                {loading ? "Đang tạo đơn..." : "Thanh toán"}
              </button>
            </div>
          </div>
        )}

        {/* ===== MODAL QR: hiển thị như popup ===== */}
        {payment && (
          <div
            className="fixed inset-0 z-[1200]"
            role="dialog"
            aria-modal="true"
            aria-label="QR thanh toán"
          >
            {/* overlay */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
              onClick={closePayment}
            />
            {/* modal */}
            <div className="absolute inset-0 flex items-center justify-center p-3">
              <div
                className="relative w-full max-w-[840px] rounded-xl bg-[#111] border border-[#2a2a2a] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Close button */}
                {/* <button
                  onClick={closePayment}
                  className="absolute right-3 top-3 bg-transparent inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 text-[#c9c9c9]"
                  aria-label="Đóng popup"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6l-12 12" />
                  </svg>
                </button> */}

                <h3 className="text-white text-center text-lg md:text-xl font-codec pt-5">
                  {payment.status === "paid" ? "Đã nhận thanh toán" : "Quét QR để thanh toán"}
                </h3>

                <div className="relative flex flex-col md:flex-row gap-5 md:gap-6 z-[1000] p-5 md:p-6">
                  {/* QR / trạng thái */}
                  <div className="flex flex-col items-center gap-3 mx-auto">
                    {payment.status === "paid" ? (
                      <div className="w-[260px] h-[260px] rounded-md border border-green-600/40 bg-green-500/10 flex items-center justify-center transition-all">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-24 h-24 text-green-500"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-label="Thanh toán thành công"
                        >
                          <circle cx="12" cy="12" r="10" className="opacity-60"></circle>
                          <path d="M7 13l3 3 7-7"></path>
                        </svg>
                      </div>
                    ) : (
                      <img
                        src={payment.qrUrl}
                        alt="Mã QR SePay"
                        className="w-[260px] h-[260px] object-contain rounded-md bg-white"
                      />
                    )}

                    <div className={`text-xs ${payment.status === "paid" ? "text-green-400" : "text-[#a8a8a8]"}`}>
                      {payment.status === "paid"
                        ? "Thanh toán thành công"
                        : "QR từ SePay • Hỗ trợ hầu hết app ngân hàng"}
                    </div>
                  </div>

                  {/* Thông tin đơn */}
                  <div className="flex-1 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[#c9c9c9] font-source">Mã đơn</span>
                      <span className="text-white">{payment.orderCode}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#c9c9c9] font-source">Số tiền</span>
                      <span className="text-white">
                        {nf.format(payment.total)} {payment.currency}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#c9c9c9] font-source">Ngân hàng</span>
                      <span className="text-white">{payment.bank?.nameOrCode || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#c9c9c9] font-source">Số TK</span>
                      <span className="text-white">{payment.bank?.accountNo || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#c9c9c9] font-source">Tên TK</span>
                      <span className="text-white">{payment.bank?.accountName || "-"}</span>
                    </div>

                    {payment.status === "paid" ? (
                      <div className="text-green-400 text-xs font-source">
                        Xác nhận lúc:{" "}
                        {payment.paidAt ? new Date(payment.paidAt).toLocaleString("vi-VN") : "—"}
                      </div>
                    ) : (
                      <div className="text-[#bdbdbd] text-xs">
                        Đang chờ thanh toán... (tự động cập nhật)
                      </div>
                    )}

                    <a
                      href={payment.qrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block w-full text-center rounded-md bg-[#8f120d] hover:opacity-90 text-white py-2 font-source"
                    >
                      Mở QR ở tab mới
                    </a>

                    <button
                      onClick={closePayment}
                      className="mt-2 w-full bg-transparent rounded-md border border-[#333] hover:bg-white/5 text-[#c9c9c9] py-2 font-source"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* POPUP Tổng quan đơn nạp */}
    </>
  );
}
