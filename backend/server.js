import express from "express";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import { neon } from "@neondatabase/serverless";

const app = express();

// FIX 1: CORS Configuration - Allow your Vercel domain
app.use(cors({
  origin: ['https://brightnal.vercel.app', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// FIX 2: Increase payload limit for large base64 images (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// FIX 3: Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000);
  next();
});

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

// Database connection
const sql = neon(process.env.DATABASE_URL);

let status = {
  cloudinary: false,
  database: false
};

// FIX 4: Better connection testing with retry logic
async function testConnections() {
  let dbRetries = 3;
  let cloudRetries = 3;
  
  // Test database with retries
  while (dbRetries > 0) {
    try {
      await sql`SELECT 1`;
      console.log("✅ Neon database connected");
      status.database = true;
      break;
    } catch (error) {
      dbRetries--;
      console.log(`⚠️  Database connection attempt failed. Retries left: ${dbRetries}`);
      if (dbRetries === 0) {
        console.error("❌ Neon database connection failed:", error.message);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
      }
    }
  }
  
  // Test Cloudinary with retries
  while (cloudRetries > 0) {
    try {
      await cloudinary.api.ping();
      console.log("✅ Cloudinary connected");
      status.cloudinary = true;
      break;
    } catch (error) {
      cloudRetries--;
      console.log(`⚠️  Cloudinary connection attempt failed. Retries left: ${cloudRetries}`);
      if (cloudRetries === 0) {
        console.error("❌ Cloudinary connection failed:", error.message);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
}

// FIX 5: Initialize database with better error handling
async function initializeDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        sku TEXT UNIQUE NOT NULL,
        images TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log("✅ Products table initialized");
  } catch (error) {
    console.error("❌ Database initialization error:", error.message);
  }
}

// FIX 6: Wait for connections before starting server
async function initialize() {
  await testConnections();
  await initializeDatabase();
}

// Start initialization
initialize();

// ROUTES

// Health check endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Brightnal backend is running ✔",
    timestamp: new Date().toISOString()
  });
});

app.get("/status", (req, res) => {
  res.json({
    ...status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  const isHealthy = status.cloudinary && status.database;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "unhealthy",
    services: status
  });
});

// FIX 7: Add error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Get all products
app.get("/api/products", asyncHandler(async (req, res) => {
  if (!status.database) {
    return res.status(503).json({ error: "Database not available. Please try again." });
  }
  
  const products = await sql`
    SELECT * FROM products 
    ORDER BY created_at DESC
  `;
  res.json(products);
}));

// Get single product
app.get("/api/products/:id", asyncHandler(async (req, res) => {
  if (!status.database) {
    return res.status(503).json({ error: "Database not available. Please try again." });
  }
  
  const { id } = req.params;
  const product = await sql`
    SELECT * FROM products 
    WHERE id = ${id}
  `;
  
  if (product.length === 0) {
    return res.status(404).json({ error: "Product not found" });
  }
  
  res.json(product[0]);
}));

// Create product
app.post("/api/products", asyncHandler(async (req, res) => {
  if (!status.database) {
    return res.status(503).json({ error: "Database not available. Please try again." });
  }
  
  if (!status.cloudinary) {
    return res.status(503).json({ error: "Image service not available. Please try again." });
  }
  
  const { name, description, category, price, stock, sku, images } = req.body;
  
  // Validate required fields
  if (!name || !category || price === undefined || !sku) {
    return res.status(400).json({ 
      error: "Missing required fields",
      required: ["name", "category", "price", "sku"]
    });
  }
  
  let cloudinaryUrls = [];
  
  // Upload images to Cloudinary
  if (images && images.length > 0) {
    console.log(`📤 Uploading ${images.length} images to Cloudinary...`);
    
    for (let i = 0; i < images.length; i++) {
      const base64Image = images[i];
      try {
        const uploadResult = await cloudinary.uploader.upload(base64Image, {
          folder: "brightnal_products",
          resource_type: "auto",
          timeout: 60000 // 60 second timeout
        });
        cloudinaryUrls.push(uploadResult.secure_url);
        console.log(`✅ Image ${i + 1}/${images.length} uploaded`);
      } catch (uploadError) {
        console.error(`❌ Cloudinary upload error for image ${i + 1}:`, uploadError.message);
        // Continue with other images
      }
    }
  }
  
  // Generate product ID
  const productId = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  // Insert into database
  const result = await sql`
    INSERT INTO products (id, name, description, category, price, stock, sku, images)
    VALUES (
      ${productId},
      ${name},
      ${description || ''},
      ${category},
      ${parseFloat(price)},
      ${parseInt(stock) || 0},
      ${sku},
      ${cloudinaryUrls}
    )
    RETURNING *
  `;
  
  console.log(`✅ Product created: ${name}`);
  res.status(201).json(result[0]);
}));

// Update product
app.put("/api/products/:id", asyncHandler(async (req, res) => {
  if (!status.database) {
    return res.status(503).json({ error: "Database not available. Please try again." });
  }
  
  const { id } = req.params;
  const { name, description, category, price, stock, sku, images } = req.body;
  
  // Check if product exists
  const existing = await sql`SELECT * FROM products WHERE id = ${id}`;
  if (existing.length === 0) {
    return res.status(404).json({ error: "Product not found" });
  }
  
  let cloudinaryUrls = existing[0].images || [];
  
  // Handle images
  if (images && images.length > 0) {
    // Separate new images (base64) from existing URLs
    const newImages = images.filter(img => img.startsWith('data:'));
    const existingUrls = images.filter(img => !img.startsWith('data:'));
    
    cloudinaryUrls = [...existingUrls];
    
    // Upload new images
    if (newImages.length > 0 && status.cloudinary) {
      console.log(`📤 Uploading ${newImages.length} new images...`);
      
      for (let i = 0; i < newImages.length; i++) {
        try {
          const uploadResult = await cloudinary.uploader.upload(newImages[i], {
            folder: "brightnal_products",
            resource_type: "auto",
            timeout: 60000
          });
          cloudinaryUrls.push(uploadResult.secure_url);
          console.log(`✅ New image ${i + 1}/${newImages.length} uploaded`);
        } catch (uploadError) {
          console.error(`❌ Upload error for image ${i + 1}:`, uploadError.message);
        }
      }
    }
  }
  
  // Update database
  const result = await sql`
    UPDATE products
    SET 
      name = ${name},
      description = ${description},
      category = ${category},
      price = ${parseFloat(price)},
      stock = ${parseInt(stock)},
      sku = ${sku},
      images = ${cloudinaryUrls},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `;
  
  console.log(`✅ Product updated: ${name}`);
  res.json(result[0]);
}));

// Delete product
app.delete("/api/products/:id", asyncHandler(async (req, res) => {
  if (!status.database) {
    return res.status(503).json({ error: "Database not available. Please try again." });
  }
  
  const { id } = req.params;
  
  // Get product
  const product = await sql`SELECT * FROM products WHERE id = ${id}`;
  if (product.length === 0) {
    return res.status(404).json({ error: "Product not found" });
  }
  
  // Delete images from Cloudinary
  if (product[0].images && product[0].images.length > 0 && status.cloudinary) {
    console.log(`🗑️  Deleting ${product[0].images.length} images from Cloudinary...`);
    
    for (const imageUrl of product[0].images) {
      try {
        // Extract public_id from URL
        const urlParts = imageUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        const publicId = `brightnal_products/${filename.split('.')[0]}`;
        
        await cloudinary.uploader.destroy(publicId);
        console.log(`✅ Image deleted from Cloudinary`);
      } catch (deleteError) {
        console.error("❌ Cloudinary delete error:", deleteError.message);
        // Continue even if image deletion fails
      }
    }
  }
  
  // Delete from database
  await sql`DELETE FROM products WHERE id = ${id}`;
  
  console.log(`✅ Product deleted: ${product[0].name}`);
  res.json({ message: "Product deleted successfully" });
}));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  
  if (err.name === 'PayloadTooLargeError') {
    return res.status(413).json({ error: "Request too large. Please reduce image sizes." });
  }
  
  res.status(500).json({ 
    error: "Something went wrong!",
    message: err.message 
  });
});

// Start server
const PORT = process.env.PORT || 7700;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: ${PORT === 7700 ? 'http://localhost:7700' : 'https://brightnal.onrender.com'}`);
});
