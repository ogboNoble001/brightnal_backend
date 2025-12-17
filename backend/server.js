import express from "express";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import { neon } from "@neondatabase/serverless";

const app = express();

app.use(cors({
  origin: 'https://brightnal.vercel.app'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET
});

const sql = neon(process.env.DATABASE_URL);

let status = {
  cloudinary: false,
  database: false
};

async function testConnections() {
  try {
    await sql`SELECT 1`;
    console.log("Neon database connected ✔");
    status.database = true;
  } catch (error) {
    console.log("Neon database connection failed ❌");
    console.error(error.message);
  }
  
  try {
    await cloudinary.api.ping();
    console.log("Cloudinary connected ✔");
    status.cloudinary = true;
  } catch (error) {
    console.log("Cloudinary connection failed ❌");
    console.error(error.message);
  }
}

testConnections();

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
    console.log("Products table initialized ✔");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

initializeDatabase();

app.get("/api/products", async (req, res) => {
  try {
    const products = await sql`
      SELECT * FROM products 
      ORDER BY created_at DESC
    `;
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const product = await sql`
      SELECT * FROM products 
      WHERE id = ${id}
    `;
    if (product.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product[0]);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, description, category, price, stock, sku, images } = req.body;
    if (!name || !category || !price || !sku) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    let cloudinaryUrls = [];
    if (images && images.length > 0) {
      for (const base64Image of images) {
        try {
          const uploadResult = await cloudinary.uploader.upload(base64Image, {
            folder: "brightnal_products",
            resource_type: "auto"
          });
          cloudinaryUrls.push(uploadResult.secure_url);
        } catch (uploadError) {
          console.error("Cloudinary upload error:", uploadError);
        }
      }
    }
    
    const productId = 'prod_' + Date.now();
    
    const result = await sql`
      INSERT INTO products (id, name, description, category, price, stock, sku, images)
      VALUES (
        ${productId},
        ${name},
        ${description || ''},
        ${category},
        ${price},
        ${stock || 0},
        ${sku},
        ${cloudinaryUrls}
      )
      RETURNING *
    `;
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error("Error creating product:", error);
    if (error.message.includes('duplicate key')) {
      res.status(400).json({ error: "SKU already exists" });
    } else {
      res.status(500).json({ error: "Failed to create product" });
    }
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, price, stock, sku, images } = req.body;
    
    const existing = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (existing.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    let cloudinaryUrls = existing[0].images || [];
    if (images && images.length > 0) {
      const newImages = images.filter(img => img.startsWith('data:'));
      const existingUrls = images.filter(img => !img.startsWith('data:'));
      cloudinaryUrls = [...existingUrls];
      for (const base64Image of newImages) {
        try {
          const uploadResult = await cloudinary.uploader.upload(base64Image, {
            folder: "brightnal_products",
            resource_type: "auto"
          });
          cloudinaryUrls.push(uploadResult.secure_url);
        } catch (uploadError) {
          console.error("Cloudinary upload error:", uploadError);
        }
      }
    }
    
    const result = await sql`
      UPDATE products
      SET 
        name = ${name},
        description = ${description},
        category = ${category},
        price = ${price},
        stock = ${stock},
        sku = ${sku},
        images = ${cloudinaryUrls},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;
    
    res.json(result[0]);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const product = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (product.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    if (product[0].images && product[0].images.length > 0) {
      for (const imageUrl of product[0].images) {
        try {
          const publicId = imageUrl.split('/').slice(-2).join('/').split('.')[0];
          await cloudinary.uploader.destroy(publicId);
        } catch (deleteError) {
          console.error("Cloudinary delete error:", deleteError);
        }
      }
    }
    
    await sql`DELETE FROM products WHERE id = ${id}`;
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

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

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 7700;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});