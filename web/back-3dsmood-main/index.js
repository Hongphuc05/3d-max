
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport.config');
const fs = require('fs');

const categoryRoutes = require("./routes/category.routes");
const productRoutes = require("./routes/product3dmodel.routes");
const styleRoutes = require("./routes/styleRoutes");
const colorRoutes = require("./routes/colorRoutes");
const formsRouter = require("./routes/forms");
const materialsRouter = require("./routes/materials");
const discountRoutes = require("./routes/discount.routes");
const orderRoutes = require("./routes/order.routes");
const downloadRoutes = require("./routes/download.routes");
const accountRoutes = require("./routes/user.routes");
const collectionsRouter = require('./routes/collection.routes');
const accountcollectionsRouter = require("./routes/account.collections.routes");
const uploadRouter = require("./routes/adminprofile.routes");
const productDetail = require("./routes/product.detail");
const scenesProduct = require("./routes/3dscenes.product")
const productDetail3dscenes = require("./routes/product.detatail3dscenes");
const Home = require("./routes/home.routes");
const Cart = require("./routes/cart.routes");
const paymentsRoutes = require("./routes/payments.routes");
const pointsRoutes = require("./routes/points.routes");
const adminStatsRoutes = require("./routes/admin.stats.routes");
const adminDepositsRoutes = require('./routes/admin.deposits.routes');
const productStatusRoutes = require('./routes/productStatus.routes');
const slidesRouter = require('./routes/home.slides.routes');
const backgroundsRoutes = require("./routes/background.routes");
const uploadPresignRouter = require("./routes/uploadPresign.routes");

const app = express();
// app.use(cors());
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
const cookieParser = require("cookie-parser");
app.use(cookieParser());
app.use(express.json());
const authRoutes = require("./routes/auth");
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    // vd: File too large
    return res.status(400).send(err.message);
  }
  if (err && err.message) {
    // từ fileFilter (sai loại file)
    const m = err.message.toLowerCase();
    if (m.includes("preview") || m.includes("model") || m.includes("file type")) {
      return res.status(400).send(err.message);
    }
  }
  next(err);
});

// Session
app.use(session({
  secret: 'your-secret',
  resave: false,
  saveUninitialized: false,
}));
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Định nghĩa thư mục lưu ảnh phụ


app.use("/api/auth", authRoutes);
app.get("/", (req, res) => {
  res.status(200).send("OK");
});
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/styles", styleRoutes);
app.use("/api/colors", colorRoutes);
app.use("/api/forms", formsRouter);
app.use("/api/materials", materialsRouter);
app.use('/api/admin/users', require('./routes/admin.users.routes'));
app.use("/api/discounts", discountRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/account", accountRoutes);
app.use('/api/collections', collectionsRouter);
app.use("/api/account/collections", accountcollectionsRouter);
app.use("/api/uploads", uploadRouter);
app.use("/api/product-detail", productDetail);
app.use("/api/product-scenes", scenesProduct);
app.use("/api/product-detail3dscenes", productDetail3dscenes);
app.use("/api/home", Home);
app.use("/api/cart", Cart);
app.use("/api/payments", paymentsRoutes);
app.use("/api/points", pointsRoutes);
app.use("/api/admin/stats", adminStatsRoutes);
app.use("/api/deposit-packs", require("./routes/depositPack.routes"));
app.use("/api/sepay", require("./routes/sepay.routes"));
app.use('/api/admin', adminDepositsRoutes);
app.use("/api", require("./routes/deposits.routes"));
app.use(require('./routes/public.popup'));
app.use(require('./routes/admin.popup'));
app.use('/api', productStatusRoutes);
app.use('/api/home/slides', slidesRouter);
app.use("/api/backgrounds", backgroundsRoutes);
app.use("/api/bg-files", require("./routes/bgFiles.routes"));
app.use("/api", uploadPresignRouter);

// app.use('/api/users', require('./routes/user.routes'));
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    console.log('📶 Connection state:', mongoose.connection.readyState);
    
    // Diễn giải rõ trạng thái
    switch (mongoose.connection.readyState) {
      case 0:
        console.log("❌ Disconnected");
        break;
      case 1:
        console.log("✅ Connected to MongoDB");
        break;
      case 2:
        console.log("⏳ Connecting...");
        break;
      case 3:
        console.log("🔌 Disconnecting...");
        break;
      default:
        console.log("❓ Unknown connection state");
    }
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
console.log('🔍 MONGO_URI =', process.env.MONGO_URI);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

