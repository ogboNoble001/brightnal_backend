import express from "express";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import { neon } from "@neondatabase/serverless";

const app = express();

app.use(cors());
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