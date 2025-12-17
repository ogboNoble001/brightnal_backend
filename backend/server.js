import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import pkg from "pg";
import cors from "cors";

dotenv.config();
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

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});

const allowedOrigins = [
"https://brightnal-backend.vercel.app"
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
const PORT = process.env.PORT || 7700;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));