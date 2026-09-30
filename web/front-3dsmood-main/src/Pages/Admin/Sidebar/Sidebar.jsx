import React from 'react';
import {
  FaTachometerAlt, FaCalendarAlt, FaUser, FaBoxOpen, FaUsers,
  FaListAlt, FaImage, FaComments, FaEnvelope, FaReceipt, FaPercent,
  FaCoins,
  FaCreditCard, // Payments + Card Payments
} from 'react-icons/fa';
import { useLocation, useNavigate } from 'react-router-dom';

const Sidebar = ({ activeKey }) => {
  const [openProduct, setOpenProduct] = React.useState(true);
  const [openPayments, setOpenPayments] = React.useState(true); // NEW: toggle nhóm Payments
  const location = useLocation();
  const navigate = useNavigate();

  // Suy ra key theo URL nếu không truyền activeKey
  const keyFromPath = React.useMemo(() => {
    const map = [
      { key: 'dashboard',           match: /^\/admin(\/dashboard)?\/?$/ },
      { key: 'calendar',            match: /^\/admin\/calendar/ },
      { key: 'user',                match: /^\/admin\/account/ },
      { key: 'customer',            match: /^\/admin\/list-user/ },
      { key: 'product.3dmodels',    match: /^\/admin\/list-product-3dmodels?/ },
      { key: 'product.3dscenes',    match: /^\/admin\/list-product-3dscenes?/ },
      { key: 'order',               match: /^\/admin\/orders?/ },

      // ĐẶT 'payment.card' TRƯỚC 'payment' để match đường dẫn con chính xác
      { key: 'payment.card',        match: /^\/admin\/payments\/cards?/ },  // NEW
      { key: 'payment',             match: /^\/admin\/payments?\/?$/ },     // tổng quan payments

      { key: 'category',            match: /^\/admin\/categories?/ },
      { key: 'discount',            match: /^\/admin\/discounts?/ },
      { key: 'banner',              match: /^\/admin\/banners?/ },

      // NEW: popup
      { key: 'popup',               match: /^\/admin\/home-popup/ },

      { key: 'chat',                match: /^\/admin\/chat/ },
      { key: 'email',               match: /^\/admin\/email/ },
      { key: 'invoice',             match: /^\/admin\/invoice/ },
      { key: 'point',               match: /^\/admin\/point-config/ },
    ];
    return (map.find(m => m.match.test(location.pathname))?.key) || 'dashboard';
  }, [location.pathname]);

  const currentKey = activeKey || keyFromPath;

  // Tự mở nhóm Product và Payments nếu currentKey nằm trong product.* hoặc payment.*
  React.useEffect(() => {
    if (String(currentKey).startsWith('product')) setOpenProduct(true);
    if (String(currentKey).startsWith('payment')) setOpenPayments(true);
  }, [currentKey]);

  const base = "flex items-center gap-2 p-1 cursor-pointer rounded";
  const active = "font-semibold bg-blue-100 text-blue-600";
  const inactive = "text-gray-700 hover:bg-gray-100";
  const itemCls = (key, extra = "") =>
    `${base} ${currentKey === key ? active : inactive} ${extra}`;

  return (
    <aside className="w-64 bg-white border-r p-6 overflow-y-auto">
      <h1 className="text-2xl font-bold text-blue-600 mb-8">3dsMoodAdmin</h1>

      <nav className="space-y-2 text-gray-700">
        {/* Dashboard */}
        <div className={itemCls('dashboard')} onClick={() => navigate('/admin')}>
          <FaTachometerAlt /> Dashboard
        </div>

        {/* User Profile */}
        <div className={itemCls('user')} onClick={() => navigate('/admin/account')}>
          <FaUser /> User Profile
        </div>
        <div className={itemCls('topmodel')} onClick={() => navigate('/admin/topmodel')}>
          <FaBoxOpen /> Top Model
        </div>
        {/* Product - nhóm có submenu */}
        <div
          className={`${base} ${String(currentKey).startsWith('product') ? active : inactive}`}
          onClick={() => setOpenProduct(!openProduct)}
        >
          <FaBoxOpen /> Product
        </div>

        {openProduct && (
          <div className="ml-6 space-y-1">
            <div
              className={itemCls('product.3dmodels')}
              onClick={() => navigate('/admin/list-product-3dmodel')}
            >
              3D Model
            </div>
            <div
              className={itemCls('product.3dscenes')}
              onClick={() => navigate('/admin/list-product-3dscenes')}
            >
              3D Scenes
            </div>
          </div>
        )}

        {/* Customer */}
        <div className={itemCls('customer')} onClick={() => navigate('/admin/list-user')}>
          <FaUsers /> Customer
        </div>

        {/* Orders (đồng bộ route số nhiều) */}
        <div className={itemCls('order')} onClick={() => navigate('/admin/order')}>
          <FaReceipt /> Orders
        </div>

        {/* Payments — nhóm có submenu (NEW) */}
        <div
          className={`${base} ${String(currentKey).startsWith('payment') ? active : inactive}`}
          onClick={() => setOpenPayments(!openPayments)}
        >
          <FaCreditCard /> Payments
        </div>

        {openPayments && (
          <div className="ml-6 space-y-1">
            <div
              className={itemCls('payment')}
              onClick={() => navigate('/admin/list-payment')}
            >
              <FaCreditCard className="opacity-70" /> Tất cả Payments
            </div>
            <div
              className={itemCls('payment.card')}
              onClick={() => navigate('/admin/list-deposit-pack')}
            >
              <FaCreditCard className="opacity-70" /> Card Payments
            </div>
          </div>
        )}

        {/* Discount */}
        <div className={itemCls('discount')} onClick={() => navigate('/admin/discount')}>
          <FaPercent /> Discount
        </div>

        {/* Point Config */}
        <div className={itemCls('point')} onClick={() => navigate('/admin/point-config')}>
          <FaCoins /> Point Config
        </div>

        {/* Banner */}
        <div className={itemCls('slide')} onClick={() => navigate('/admin/slide')}>
          <FaImage /> Banner
        </div>

        {/* Popup (NEW) */}
        <div className={itemCls('popup')} onClick={() => navigate('/admin/pop-up')}>
          <FaListAlt /> Popup
        </div>
        <div className={itemCls('background')} onClick={() => navigate('/admin/bg')}>
          <FaImage /> Background
        </div>
        {/* Support */}
        <p className="uppercase text-xs text-gray-400 pt-6">Support</p>
      </nav>
    </aside>
  );
};

export default Sidebar;
