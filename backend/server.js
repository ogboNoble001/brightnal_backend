import express from "express";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import { neon } from "@neondatabase/serverless";

const app = express();

// CORS Configuration
app.use(cors({
  origin: ['https://brightnal.vercel.app', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true,
  methods: ['PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase payload limit for large base64 images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request timeout middleware
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

// Test connections with retry logic
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
        await new Promise(resolve => setTimeout(resolve, 2000));
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

// Initialize
testConnections();

// ROUTES

// Health check
app.get("/", (req, res) => {
  res.json({
    message: "Brightnal backend is running - UPDATE ONLY MODE ✔",
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

// Error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Update product - ONLY ROUTE
app.put("/api/products/:id", asyncHandler(async (req, res) => {
  console.log("📥 Update request received for product:", req.params.id);
  
  // Check services
  if (!status.database) {
    console.log("❌ Database not available");
    return res.status(503).json({ 
      success: false,
      message: "Database not available. Please try again." 
    });
  }
  
  if (!status.cloudinary) {
    console.log("❌ Cloudinary not available");
    return res.status(503).json({ 
      success: false,
      message: "Image service not available. Please try again." 
    });
  }
  
  const { id } = req.params;
  const { name, description, category, price, stock, sku, images } = req.body;
  
  console.log("📋 Update data received:", { name, category, price, sku, imageCount: images?.length || 0 });
  
  // Check if product exists
  console.log("🔍 Checking if product exists...");
  const existing = await sql`SELECT * FROM products WHERE id = ${id}`;
  
  if (existing.length === 0) {
    console.log("❌ Product not found:", id);
    return res.status(404).json({ 
      success: false,
      message: "Product not found" 
    });
  }
  
  console.log("✅ Product found:", existing[0].name);
  
  let cloudinaryUrls = existing[0].images || [];
  
  // Handle images
  if (images && images.length > 0) {
    console.log("🖼️  Processing images...");
    
    // Separate new images (base64) from existing URLs
    const newImages = images.filter(img => img.startsWith('data:'));
    const existingUrls = images.filter(img => !img.startsWith('data:'));
    
    console.log(`📊 Image breakdown: ${newImages.length} new, ${existingUrls.length} existing`);
    
    cloudinaryUrls = [...existingUrls];
    
    // Upload new images
    if (newImages.length > 0) {
      console.log(`📤 Starting upload of ${newImages.length} new images to Cloudinary...`);
      
      for (let i = 0; i < newImages.length; i++) {
        try {
          console.log(`⏳ Uploading image ${i + 1}/${newImages.length}...`);
          
          const uploadResult = await cloudinary.uploader.upload(newImages[i], {
            folder: "brightnal_products",
            resource_type: "auto",
            timeout: 60000
          });
          
          cloudinaryUrls.push(uploadResult.secure_url);
          console.log(`✅ Image ${i + 1}/${newImages.length} uploaded successfully`);
        } catch (uploadError) {
          console.error(`❌ Upload error for image ${i + 1}:`, uploadError.message);
        }
      }
      
      console.log(`✅ Image upload complete. Total images: ${cloudinaryUrls.length}`);
    }
  }
  
  // Update database
  console.log("💾 Updating database...");
  
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
  
  console.log(`✅ Product updated successfully: ${name}`);
  
  res.json({ 
    success: true,
    message: `Product "${name}" has been updated successfully!`,
    productId: id,
    imagesUploaded: cloudinaryUrls.length
  });
}));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: "Route not found. Only PUT /api/products/:id is available." 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  
  if (err.name === 'PayloadTooLargeError') {
    return res.status(413).json({ 
      success: false,
      message: "Request too large. Please reduce image sizes." 
    });
  }
  
  res.status(500).json({ 
    success: false,
    message: "Something went wrong while updating the product.",
    error: err.message 
  });
});

// Start server
const PORT = process.env.PORT || 7700;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} - UPDATE ONLY MODE`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: ${PORT === 7700 ? 'http://localhost:7700' : 'https://brightnal.onrender.com'}`);
  console.log(`⚠️  Only PUT /api/products/:id endpoint is active`);
});

const response = await fetch(`${API_URL}/api/products/${productId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(productData)
});

