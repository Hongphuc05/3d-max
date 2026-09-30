import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import Home from './Pages/Client/Home';
import ModelGallery from './Pages/Client/3dModel';
import LoginForm from './Pages/Auth/login';
import SignupForm from './Pages/Auth/signup';
import Dashboard from './Pages/Admin/Dashboard';
import ProductDetail from './Pages/Client/Product-detail';
import GalleryGrid from './Pages/Client/3dScenes';
import ProductDetailScenes from './Pages/Client/Product-detail-3dscenes';
import GoogleCallback from './Pages/Auth/GoogleCallback';
import ProductForm3dmodel from './Pages/Admin/Products/AddProduct3dmodel';
import CategoryManager from './Pages/Admin/CategoryProducts/CategoryManager';
import ProductList3dmodel from './Pages/Admin/Products/ProductList3dmodel';
import AccountDashboard from './Pages/Client/Account';
import UserManagement from './Pages/Admin/User/UserManagement';
import DiscountsPage from './Pages/Admin/Discount/Discounts';
import RoleGuard from "./Components/guards/RoleGuard";
import AdminProfileAccount from './Pages/Admin/User/ProfileAdmin';
import ProductForm3dscenes from './Pages/Admin/Products/AddProduct3dscenes';
import ProductScenesManager from './Pages/Admin/Products/ProductList3dscenes';
import AdminOrderPage from './Pages/Admin/Orders/OrderManagement';
import PointConfig from './Pages/Admin/PointConfig';
import Header from './Components/header';
import AdminDepositPacks from './Pages/Admin/AdminDepositPacks';
import SePayAdminManager from './Pages/Admin/Payment/SePayAdminManager';
import HomePopupSettings from './Pages/Admin/HomePopupSettings';
import HomeSlidesAdmin from './Pages/Admin/HomeSlides';
import BackgroundManager from './Pages/Admin/AdminBackgrounds';
import BgFilesAdmin from './Pages/Admin/BgFilesAdmin';
import TopPurchasedProducts from './Pages/Admin/TopPurchasedProducts';

function App() {
  const [count, setCount] = useState(0);

  return (

    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/3d-model" element={<ModelGallery />} />
        <Route path="/3d-scenes" element={<GalleryGrid />} />
        <Route path="/login" element={<LoginForm />} />
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/product-detail/:id" element={<ProductDetail />} />
        <Route path="/product-detail-scenes/:id" element={<ProductDetailScenes />} />
        <Route path="/account/:tab?" element={<AccountDashboard />} />

        <Route path="/google-callback" element={<GoogleCallback />} />
        {/* <Route path="/admin/account" element={<AdminProfileAccount />} />
        <Route path="/admin/add-product-3dmodel" element={<ProductForm3dmodel />} />
        <Route path="/admin/add-product-3dscenes" element={<ProductForm3dscenes />} />
        <Route path="/admin/list-product-3dscenes" element={<ProductScenesManager />} /> */}

        <Route element={<RoleGuard roles={['admin']}/>}>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/add-product-3dmodel" element={<ProductForm3dmodel />} />
        <Route path="/admin/list-product-3dmodel" element={<ProductList3dmodel />} />
        <Route path="/admin/list-user" element={<UserManagement />} />
        <Route path="/admin/discount" element={<DiscountsPage />} />
        <Route path="/admin/order" element={<AdminOrderPage />} />
        {/* <Route path="/admin/order" element={<AdminOrderPage />} /> */}
        <Route path="/admin/point-config" element={<PointConfig />} />
        <Route path="/test" element={<Header />} />
        <Route path="/admin/account" element={<AdminProfileAccount />} />
        <Route path="/admin/add-product-3dmodel" element={<ProductForm3dmodel />} />
        <Route path="/admin/add-product-3dscenes" element={<ProductForm3dscenes />} />
        <Route path="/admin/list-product-3dscenes" element={<ProductScenesManager />} />
        <Route path="/admin/list-deposit-pack" element={<AdminDepositPacks />} />
        <Route path="/admin/list-payment" element={<SePayAdminManager />} />
        <Route path="/admin/pop-up" element={<HomePopupSettings />} />
        <Route path="/admin/slide" element={<HomeSlidesAdmin />} />
        <Route path="/admin/bg" element={<BgFilesAdmin />} />
        <Route path="/admin/topmodel" element={<TopPurchasedProducts />} />

        </Route>
      </Routes>
    </Router>


  );
}

export default App;
