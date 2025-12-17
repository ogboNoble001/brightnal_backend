const form = document.getElementById("uploadForm");
const messageDiv = document.getElementById("message");
const productList = document.getElementById("productList");
const loadBtn = document.getElementById("loadProductsBtn");

const SERVER_URL = "https://brightnal.onrender.com";

/* ---------------- UPLOAD PRODUCT ---------------- */

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    messageDiv.textContent = "Uploading...";
    
    const formData = new FormData(form);
    
    try {
        const response = await fetch(`${SERVER_URL}/api/upload`, {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageDiv.textContent = "✅ Product uploaded successfully!";
            form.reset();
            loadProducts(); // refresh list after upload
        } else {
            messageDiv.textContent = "❌ Upload failed: " + data.message;
        }
    } catch (error) {
        console.error(error);
        messageDiv.textContent = "❌ Upload error. Check console.";
    }
});

/* ---------------- GET ALL PRODUCTS ---------------- */

loadBtn.addEventListener("click", loadProducts);

async function loadProducts() {
    productList.innerHTML = "Loading products...";
    
    try {
        const response = await fetch(`${SERVER_URL}/api/products`);
        const data = await response.json();
        
        if (!data.success) {
            productList.textContent = "Failed to load products";
            return;
        }
        
        renderProducts(data.products);
    } catch (error) {
        console.error(error);
        productList.textContent = "Error loading products";
    }
}

/* ---------------- RENDER ---------------- */

function renderProducts(products) {
    if (!products.length) {
        productList.textContent = "No products found.";
        return;
    }
    
    productList.innerHTML = "";
    
    products.forEach((p) => {
        const div = document.createElement("div");
        div.className = "product";
        
        div.innerHTML = `
      <img src="${p.image_url}" alt="${p.product_name}" />
      <div>
        <strong>${p.product_name}</strong><br/>
        ₦${p.price} • Stock: ${p.stock}<br/>
        ${p.category || ""}
      </div>
    `;
        
        productList.appendChild(div);
    });
}