import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import pkg from "pg";
import cors from "cors";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";

dotenv.config();

// ============================================
// ENV VALIDATION
// ============================================

const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CLOUD_NAME",
  "CLOUD_KEY",
  "CLOUD_SECRET",
];

requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

// ============================================
// DATABASE
// ============================================

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query("SELECT NOW()", (err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected");
  }
});

// ============================================
// TABLE SETUP
// ============================================

const initTables = async () => {
  try {
    // Users first (products references it)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Users table ready");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        product_name TEXT NOT NULL,
        category TEXT DEFAULT 'Uncategorized',
        brand TEXT DEFAULT 'Unknown',
        price NUMERIC(12,2) DEFAULT 0 CHECK (price >= 0),
        stock INT DEFAULT 0 CHECK (stock >= 0),
        sku TEXT,
        product_class TEXT DEFAULT 'Standard',
        sizes TEXT DEFAULT 'N/A',
        colors TEXT DEFAULT 'N/A',
        description TEXT DEFAULT 'No description',
        image_url TEXT NOT NULL,
        cloudinary_id TEXT NOT NULL,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Products table ready");
  } catch (err) {
    console.error("❌ Table init error:", err.message);
    process.exit(1);
  }
};

await initTables();

// ============================================
// CLOUDINARY
// ============================================

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});

// ============================================
// APP SETUP
// ============================================

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

// ============================================
// CORS
// ============================================

const allowedOrigins = [
  "https://brightnal-backend.vercel.app",
  "http://localhost:7700",
  "https://bright-nal.vercel.app/"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ============================================
// RATE LIMITERS
// ============================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);

// ============================================
// MULTER
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// ============================================
// MIDDLEWARE
// ============================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired", expired: true });
    }
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
};

// ============================================
// HELPERS
// ============================================

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "brightnal", tags: ["brightnal"], resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
};

const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error("⚠️ Cloudinary delete failed:", err.message);
  }
};

// ============================================
// AUTH ROUTES
// ============================================

// Register
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const { email, full_name, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, full_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, role, created_at`,
      [email.toLowerCase(), full_name?.trim() || null, password_hash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "14d" }
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      user,
      token,
    });
  } catch (err) {
    console.error("❌ Register error:", err.message);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// Login
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const result = await pool.query(
      "SELECT id, email, full_name, password_hash, role FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    // Always compare to prevent timing attacks
    const dummyHash = "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashXX";
    const user = result.rows[0];
    const hashToCompare = user ? user.password_hash : dummyHash;

    const isValid = await bcrypt.compare(password, hashToCompare);

    if (!user || !isValid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "14d" }
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// Verify Token
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, full_name, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("❌ Auth/me error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch user" });
  }
});

// ============================================
// PRODUCT ROUTES
// ============================================

// GET all products (PUBLIC)
app.get("/api/products", async (req, res) => {
  try {
    const { category, brand, search, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let conditions = [];
    let values = [];
    let idx = 1;

    if (category) {
      conditions.push(`category ILIKE $${idx++}`);
      values.push(`%${category}%`);
    }
    if (brand) {
      conditions.push(`brand ILIKE $${idx++}`);
      values.push(`%${brand}%`);
    }
    if (search) {
      conditions.push(`(product_name ILIKE $${idx} OR description ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limitNum, offset]
    );

    res.status(200).json({
      success: true,
      products: result.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("❌ Fetch products error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
});

// GET single product (PUBLIC)
app.get("/api/products/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error("❌ Fetch product error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
});

// CREATE product (PROTECTED)
app.post("/api/products", upload.single("image"), async (req, res) => {
  let cloudinaryId = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Product image is required" });
    }

    const {
      productName,
      category,
      brand,
      price,
      stock,
      sku,
      productClass,
      sizes,
      colors,
      description,
    } = req.body;

    if (!productName?.trim()) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }

    const cloudinaryResult = await uploadToCloudinary(req.file.buffer);
    cloudinaryId = cloudinaryResult.public_id;

    const result = await pool.query(
      `INSERT INTO products 
        (product_name, category, brand, price, stock, sku, product_class, 
         sizes, colors, description, image_url, cloudinary_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        productName.trim(),
        category?.trim() || "Uncategorized",
        brand?.trim() || "Unknown",
        price ? Math.abs(parseFloat(price)) : 0,
        stock ? Math.abs(parseInt(stock)) : 0,
        sku?.trim() || `SKU-${Date.now()}`,
        productClass?.trim() || "Standard",
        sizes?.trim() || "N/A",
        colors?.trim() || "N/A",
        description?.trim() || "No description",
        cloudinaryResult.secure_url,
        cloudinaryResult.public_id,
      ]
    );

    res.status(201).json({
      success: true,
      product: result.rows[0],
      message: "Product created successfully",
    });
  } catch (err) {
    console.error("❌ Create product error:", err.message);
    if (cloudinaryId) await deleteFromCloudinary(cloudinaryId);
    res.status(500).json({ success: false, message: "Failed to create product" });
  }
});

// UPDATE product (PUBLIC)
app.put("/api/products/:id", upload.single("image"), async (req, res) => {
  let newCloudinaryId = null;

  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const existing = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = existing.rows[0];

    const {
      productName,
      category,
      brand,
      price,
      stock,
      sku,
      productClass,
      sizes,
      colors,
      description,
    } = req.body;

    let imageUrl = product.image_url;
    let cloudinaryId = product.cloudinary_id;

    if (req.file) {
      const cloudinaryResult = await uploadToCloudinary(req.file.buffer);
      newCloudinaryId = cloudinaryResult.public_id;
      imageUrl = cloudinaryResult.secure_url;

      // Delete old image after new one is confirmed
      await deleteFromCloudinary(product.cloudinary_id);
      cloudinaryId = newCloudinaryId;
    }

    const result = await pool.query(
      `UPDATE products 
       SET product_name = $1, category = $2, brand = $3, price = $4,
           stock = $5, sku = $6, product_class = $7, sizes = $8,
           colors = $9, description = $10, image_url = $11,
           cloudinary_id = $12
       WHERE id = $13
       RETURNING *`,
      [
        productName?.trim() || product.product_name,
        category?.trim() || product.category,
        brand?.trim() || product.brand,
        (price !== undefined && price !== "" && !isNaN(parseFloat(price))) ? Math.abs(parseFloat(price)) : product.price,
        (stock !== undefined && stock !== "" && !isNaN(parseInt(stock))) ? Math.abs(parseInt(stock)) : product.stock,
        sku?.trim() || product.sku,
        productClass?.trim() || product.product_class,
        sizes?.trim() || product.sizes,
        colors?.trim() || product.colors,
        description?.trim() || product.description,
        imageUrl,
        cloudinaryId,
        id,
      ]
    );

    res.status(200).json({
      success: true,
      product: result.rows[0],
      message: "Product updated successfully",
    });
  } catch (err) {
    console.error("❌ Update product error:", err.message);
    if (newCloudinaryId) await deleteFromCloudinary(newCloudinaryId);
    res.status(500).json({ success: false, message: "Failed to update product" });
  }
});

// DELETE product (PUBLIC)
app.delete("/api/products/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = result.rows[0];

    await pool.query("DELETE FROM products WHERE id = $1", [id]);
    await deleteFromCloudinary(product.cloudinary_id);

    res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("❌ Delete product error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.json({ success: true, message: "Brightnal API is running", version: "3.0.0" });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ success: true, status: "healthy", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ success: false, status: "unhealthy" });
  }
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err.message);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS policy violation" });
  }

  if (err.message === "Only image files are allowed") {
    return res.status(400).json({ success: false, message: err.message });
  }

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

// ============================================
// START
// ============================================

const PORT = process.env.PORT || 7700;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received: shutting down gracefully");
  server.close(() => {
    pool.end();
    console.log("Server closed");
  });
});
