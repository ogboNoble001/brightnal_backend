import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import pkg from "pg";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

dotenv.config();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { Pool } = pkg;
const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

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
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Products table ready");
  } catch (err) {
    console.error("❌ Table creation error:", err.message);
  }
};
createProductsTable();

// CREATE USERS TABLE
const createUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id TEXT UNIQUE,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT,
        avatar_url TEXT,
        password_hash TEXT,        -- for email/password signups
        auth_provider TEXT DEFAULT 'google',  -- 'google' or 'email'
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Users table ready");
  } catch (err) {
    console.error("❌ Users table error:", err.message);
  }
};

createUsersTable();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});

const allowedOrigins = [
"https://brightnal-backend.vercel.app",
"https://brightnal.vercel.app"
];

app.use(
  cors({
    origin: function(origin, callback) {

      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);
app.use(express.json());
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
});

// UPLOAD PRODUCT
app.post("/api/upload", upload.single("image"), async (req, res) => {
  let cloudinaryId = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image file uploaded" });
    }

    const { productName, category, brand, price, stock, sku, productClass, sizes, colors, description } = req.body;

    const cloudinaryResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "myAppUploads", tags: ["myApp"], resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    cloudinaryId = cloudinaryResult.public_id;

    const query = `
      INSERT INTO products 
      (product_name, category, brand, price, stock, sku, product_class, sizes, colors, description, image_url, cloudinary_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
    ];

    const dbResult = await pool.query(query, values);

    res.status(201).json({
      success: true,
      product: dbResult.rows[0],
      message: "Product uploaded successfully",
    });
  } catch (error) {
    console.error("❌ Upload error:", error.message);

    if (cloudinaryId) await cloudinary.uploader.destroy(cloudinaryId);

    res.status(500).json({
      success: false,
      message: error.message || "Upload failed",
    });
  }
});
// GET ALL PRODUCTS
app.get("/api/products", async (req, res) => {
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
// GET SINGLE PRODUCT
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
// DELETE PRODUCT
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // First, get the product to retrieve cloudinary_id
    const productResult = await pool.query(
      "SELECT cloudinary_id FROM products WHERE id = $1",
      [id]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const cloudinaryId = productResult.rows[0].cloudinary_id;

    // Delete from Cloudinary
    if (cloudinaryId) {
      await cloudinary.uploader.destroy(cloudinaryId);
    }

    // Delete from database
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
// UPDATE PRODUCT
app.put("/api/products/:id", upload.single("image"), async (req, res) => {
  let newCloudinaryId = null;
  let oldCloudinaryId = null;

  try {
    const { id } = req.params;
    const { productName, category, brand, price, stock, sku, productClass, sizes, colors, description } = req.body;

    // Get existing product
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

    let imageUrl = existingProduct.rows[0].image_url;
    let cloudinaryId = existingProduct.rows[0].cloudinary_id;

    // If new image uploaded, update Cloudinary
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

      // Delete old image from Cloudinary
      if (oldCloudinaryId) {
        await cloudinary.uploader.destroy(oldCloudinaryId);
      }
    }

    // Update database
    const query = `
      UPDATE products 
      SET product_name = $1, category = $2, brand = $3, price = $4, 
          stock = $5, sku = $6, product_class = $7, sizes = $8, 
          colors = $9, description = $10, image_url = $11, cloudinary_id = $12
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

    // Rollback: if new image was uploaded but update failed, delete it
    if (newCloudinaryId) {
      await cloudinary.uploader.destroy(newCloudinaryId);
    }

    res.status(500).json({
      success: false,
      message: error.message || "Update failed"
    });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, message: "No token provided" });
    }
    
    // Verify token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name: full_name, picture: avatar_url } = payload;
    
    // Check if user exists
    let user = await pool.query(
      "SELECT * FROM users WHERE google_id = $1 OR email = $2",
      [google_id, email]
    );
    
    if (user.rows.length === 0) {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (google_id, email, full_name, avatar_url, auth_provider) 
         VALUES ($1,$2,$3,$4,'google') RETURNING *`,
        [google_id, email, full_name, avatar_url]
      );
      user = result;
    }
    
    // ✅ Generate JWT after login
    const jwtPayload = { id: user.rows[0].id, email: user.rows[0].email };
    const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: "7d" });
    
    res.status(200).json({
      success: true,
      user: user.rows[0],
      token: jwtToken, // <-- send JWT to frontend
      message: "Login successful",
    });
    
  } catch (err) {
    console.error("❌ Google auth error:", err.message);
    res.status(500).json({ success: false, message: "Authentication failed" });
  }
});
const PORT = process.env.PORT || 7700;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
