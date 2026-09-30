// Discount.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import DownloadPopup from "../../Components/dowloadPopup"; // <-- chỉnh path cho đúng

export default function Discount({ limit = 10 }) {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // NEW: state mở popup & id mã cần áp trong popup
  const [openPopup, setOpenPopup] = useState(false);
  const [initialDiscountId, setInitialDiscountId] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await axios.get(`${API}/api/discounts/highlight?limit=${limit}`);
        if (mounted && res.data?.ok) setDiscounts(res.data.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [API, limit]);

  // if (loading) {
  //   return (
  //     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 font-codec">
  //       {Array.from({ length: limit }).map((_, i) => (
  //         <div key={i} className="h-[120px] bg-[#1c1c1c]/60 border border-[#4d4d4d] rounded-md animate-pulse" />
  //       ))}
  //     </div>
  //   );
  // }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 font-codec">
        {discounts.map((item, i) => (
          <div
            key={item._id || i}
            className="h-[120px] bg-[#1c1c1c] border border-[#4d4d4d] rounded-md text-white flex flex-col justify-start gap-y-[2px] font-codec"
          >
            <div className="flex items-center justify-between">
              <p className="font-swiss font-bold text-[28px] text-[#8f120d] pl-1">
                {(Number(item.percent) || 0)}%
              </p>
              <img
                src={item.icon || "/giamgia.svg"}
                alt="discount icon"
                className="w-11 object-contain"
              />
            </div>
            <p className="text-[10px] min-h-[16px] max-h-[16px] text-left pl-2 text-[#9e9e9e]">
              {item.text}
            </p>
            <button
              className="block mx-auto bg-[#282828] hover:bg-[#8f120d] rounded w-[98%] py-1 mt-[1.2rem] text-[#9e9e9e] border border-[#373737] font-source"
              onClick={() => {
                setInitialDiscountId(item._id); // truyền id mã
                setOpenPopup(true);             // mở popup
              }}
            >
              Áp dụng
            </button>
          </div>
        ))}
      </div>

      {/* NEW: Gắn popup trực tiếp ở đây, truyền initialDiscountId */}
      <DownloadPopup
        isOpen={openPopup}
        onClose={() => setOpenPopup(false)}
        initialDiscountId={initialDiscountId}
      />
    </>
  );
}
