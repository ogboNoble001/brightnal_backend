import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import pkg from "pg";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'JWT_SECRET',
  'CLOUD_NAME',
  'CLOUD_KEY',
  'CLOUD_SECRET'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { Pool } = pkg;
const app = express();
app.set("trust proxy", 1);

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Less strict for dev
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Create tables
const createProductsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        product_name TEXT,
        category TEXT,
        brand TEXT,
        price NUMERIC(12,2) DEFAULT 0,
        stock INT DEFAULT 0,
        sku TEXT,
        product_class TEXT,
        sizes TEXT,
        colors TEXT,
        description TEXT,
        image_url TEXT NOT NULL,
        cloudinary_id TEXT NOT NULL,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Products table ready");
  } catch (err) {
    console.error("❌ Products table error:", err.message);
  }
};

const createUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id TEXT UNIQUE,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT,
        avatar_url TEXT,
        password_hash TEXT,
        auth_provider TEXT DEFAULT 'google',
        role TEXT DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Users table ready");
  } catch (err) {
    console.error("❌ Users table error:", err.message);
  }
};

// Initialize tables
(async () => {
  await createUsersTable();
  await createProductsTable();
})();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});

// ============================================
// FULLY OPEN CORS - NO RESTRICTIONS
// ============================================
app.use(cors({
  origin: '*', // Allow ALL origins
  methods: '*', // Allow ALL methods
  allowedHeaders: '*', // Allow ALL headers
  credentials: true,
  optionsSuccessStatus: 200
}));

// Handle preflight for all routes
app.options('*', cors());

app.use(express.json());
app.use(express.static("public"));

// ============================================
// NO RATE LIMITING - REMOVED COMPLETELY
// ============================================

// Authentication Middleware (but very relaxed)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired',
        expired: true 
      });
    }
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

// Optional authentication
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      req.user = user;
    } catch (error) {
      req.user = null;
    }
  }
  next();
};

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

// Multer configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Increased to 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
});

// ============================================
// AUTH ROUTES - NO RATE LIMITING
// ============================================

// Google Authentication - FULLY OPEN
app.post("/api/auth/google", async (req, res) => {
  try {
    console.log("🔵 Received auth request from origin:", req.headers.origin);
    console.log("🔵 Request body:", req.body);
    
    const { token } = req.body;
    
    if (!token) {
      console.log("❌ No token provided");
      return res.status(400).json({ 
        success: false, 
        message: "No token provided" 
      });
    }
    
    // Verify token with Google
    let ticket;
    try {
      console.log("🔵 Verifying Google token...");
      ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      console.log("✅ Google token verified");
    } catch (verifyError) {
      console.error("❌ Google token verification failed:", verifyError);
      return res.status(401).json({ 
        success: false, 
        message: "Invalid Google token" 
      });
    }
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name: full_name, picture: avatar_url } = payload;
    
    console.log("🔵 User info from Google:", { google_id, email, full_name });
    
    // Check if user exists
    let user = await pool.query(
      "SELECT * FROM users WHERE google_id = $1 OR email = $2",
      [google_id, email]
    );
    
    if (user.rows.length === 0) {
      console.log("🔵 Creating new user...");
      const result = await pool.query(
        `INSERT INTO users (google_id, email, full_name, avatar_url, auth_provider) 
         VALUES ($1,$2,$3,$4,'google') RETURNING *`,
        [google_id, email, full_name, avatar_url]
      );
      user = result;
      console.log("✅ New user created");
    } else {
      console.log("🔵 Updating existing user...");
      const result = await pool.query(
        `UPDATE users 
         SET full_name = $1, avatar_url = $2, google_id = $3, updated_at = NOW() 
         WHERE id = $4 
         RETURNING *`,
        [full_name, avatar_url, google_id, user.rows[0].id]
      );
      user = result;
      console.log("✅ User updated");
    }
    
    // Generate JWT with longer expiry
    const jwtPayload = { 
      id: user.rows[0].id, 
      email: user.rows[0].email,
      role: user.rows[0].role 
    };
    const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET, { 
      expiresIn: "30d" // Extended to 30 days
    });
    
    console.log("✅ Login successful for:", email);
    
    res.status(200).json({
      success: true,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        full_name: user.rows[0].full_name,
        avatar_url: user.rows[0].avatar_url,
        role: user.rows[0].role
      },
      token: jwtToken,
      message: "Login successful",
    });
    
  } catch (err) {
    console.error("❌ Google auth error:", err.message);
    console.error("❌ Full error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Authentication failed. Please try again.",
      error: err.message // Added error details for debugging
    });
  }
});

// Verify JWT Token
app.post("/api/verify-token", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ 
      success: false, 
      message: "No token provided" 
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.status(200).json({ 
      success: true, 
      user: decoded 
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expired",
        expired: true 
      });
    }
    res.status(401).json({ 
      success: false, 
      message: "Invalid token" 
    });
  }
});

// Get Current User Profile
app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, full_name, avatar_url, auth_provider, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    res.status(200).json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Profile fetch error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch profile" 
    });
  }
});

// Logout
app.post("/api/auth/logout", authenticateToken, async (req, res) => {
  res.json({ 
    success: true, 
    message: "Logged out successfully" 
  });
});

// ============================================
// PRODUCT ROUTES
// ============================================

// Upload Product (PROTECTED)
app.post("/api/upload", authenticateToken, upload.single("image"), async (req, res) => {
  let cloudinaryId = null;

  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No image file uploaded" 
      });
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
      description 
    } = req.body;

    // Upload to Cloudinary
    const cloudinaryResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: "myAppUploads", 
          tags: ["myApp"], 
          resource_type: "image" 
        },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    cloudinaryId = cloudinaryResult.public_id;

    // Insert into database
    const query = `
      INSERT INTO products 
      (product_name, category, brand, price, stock, sku, product_class, 
       sizes, colors, description, image_url, cloudinary_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *;
    `;
    
    const values = [
      productName || "Untitled Product",
      category || "Uncategorized",
      brand || "Unknown",
      price ? parseFloat(price) : 0,
      stock ? parseInt(stock) : 0,
      sku || `SKU-${Date.now()}`,
      productClass || "Standard",
      sizes || "N/A",
      colors || "N/A",
      description || "No description",
      cloudinaryResult.secure_url,
      cloudinaryResult.public_id,
      req.user.id
    ];

    const dbResult = await pool.query(query, values);

    res.status(201).json({
      success: true,
      product: dbResult.rows[0],
      message: "Product uploaded successfully",
    });
  } catch (error) {
    console.error("❌ Upload error:", error.message);

    if (cloudinaryId) {
      await cloudinary.uploader.destroy(cloudinaryId).catch(err => 
        console.error("Failed to cleanup Cloudinary:", err)
      );
    }

    res.status(500).json({
      success: false,
      message: error.message || "Upload failed",
    });
  }
});

// Get All Products
app.get("/api/products", optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products ORDER BY created_at DESC"
    );
    
    res.status(200).json({
      success: true,
      products: result.rows
    });
  } catch (error) {
    console.error("❌ Fetch products error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products"
    });
  }
});

// Get Single Product
app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    res.status(200).json({
      success: true,
      product: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Fetch product error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product"
    });
  }
});

// Update Product
app.put("/api/products/:id", authenticateToken, upload.single("image"), async (req, res) => {
  let newCloudinaryId = null;
  let oldCloudinaryId = null;

  try {
    const { id } = req.params;
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
      description 
    } = req.body;

    const existingProduct = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    if (existingProduct.rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to update this product"
      });
    }

    let imageUrl = existingProduct.rows[0].image_url;
    let cloudinaryId = existingProduct.rows[0].cloudinary_id;

    if (req.file) {
      oldCloudinaryId = cloudinaryId;

      const cloudinaryResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "myAppUploads", tags: ["myApp"], resource_type: "image" },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(req.file.buffer);
      });

      newCloudinaryId = cloudinaryResult.public_id;
      imageUrl = cloudinaryResult.secure_url;
      cloudinaryId = cloudinaryResult.public_id;

      if (oldCloudinaryId) {
        await cloudinary.uploader.destroy(oldCloudinaryId).catch(err =>
          console.error("Failed to delete old image:", err)
        );
      }
    }

    const query = `
      UPDATE products 
      SET product_name = $1, category = $2, brand = $3, price = $4, 
          stock = $5, sku = $6, product_class = $7, sizes = $8, 
          colors = $9, description = $10, image_url = $11, 
          cloudinary_id = $12, updated_at = NOW()
      WHERE id = $13
      RETURNING *;
    `;

    const values = [
      productName || existingProduct.rows[0].product_name,
      category || existingProduct.rows[0].category,
      brand || existingProduct.rows[0].brand,
      price ? parseFloat(price) : existingProduct.rows[0].price,
      stock ? parseInt(stock) : existingProduct.rows[0].stock,
      sku || existingProduct.rows[0].sku,
      productClass || existingProduct.rows[0].product_class,
      sizes || existingProduct.rows[0].sizes,
      colors || existingProduct.rows[0].colors,
      description || existingProduct.rows[0].description,
      imageUrl,
      cloudinaryId,
      id
    ];

    const result = await pool.query(query, values);

    res.status(200).json({
      success: true,
      product: result.rows[0],
      message: "Product updated successfully"
    });
  } catch (error) {
    console.error("❌ Update error:", error.message);

    if (newCloudinaryId) {
      await cloudinary.uploader.destroy(newCloudinaryId).catch(err =>
        console.error("Failed to cleanup:", err)
      );
    }

    res.status(500).json({
      success: false,
      message: error.message || "Update failed"
    });
  }
});

// Delete Product
app.delete("/api/products/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const productResult = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const product = productResult.rows[0];

    if (product.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to delete this product"
      });
    }

    const cloudinaryId = product.cloudinary_id;

    if (cloudinaryId) {
      await cloudinary.uploader.destroy(cloudinaryId).catch(err =>
        console.error("Failed to delete from Cloudinary:", err)
      );
    }

    await pool.query("DELETE FROM products WHERE id = $1", [id]);

    res.status(200).json({
      success: true,
      message: "Product deleted successfully"
    });
  } catch (error) {
    console.error("❌ Delete product error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete product"
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.json({ 
    success: true, 
    message: "Brightnal API is running - DEVELOPMENT MODE (NO RESTRICTIONS)",
    version: "2.0.0-dev",
    cors: "FULLY OPEN",
    rateLimiting: "DISABLED"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ 
    success: true, 
    status: "healthy",
    timestamp: new Date().toISOString(),
    mode: "DEVELOPMENT - ALL RESTRICTIONS DISABLED"
  });
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  res.status(500).json({ 
    success: false, 
    message: err.message || 'Internal server error',
    error: err.stack // Show full error in dev mode
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 7700;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: DEVELOPMENT`);
  console.log(`⚠️  WARNING: Running with NO SECURITY RESTRICTIONS`);
  console.log(`⚠️  CORS: FULLY OPEN`);
  console.log(`⚠️  Rate Limiting: DISABLED`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end();
  });
});
