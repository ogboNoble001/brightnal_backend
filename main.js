const form = document.getElementById("uploadForm");
const messageDiv = document.getElementById("message");
const productList = document.getElementById("productList");
const loadBtn = document.getElementById("loadProductsBtn");

const SERVER_URL = "https://brightnal.onrender.com";

let currentUpdateId = null;

/* ---------------- UPLOAD/UPDATE PRODUCT ---------------- */

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const formData = new FormData(form);
    
    // Check if we're updating or uploading
    if (currentUpdateId) {
        messageDiv.textContent = "Updating...";
        await updateProduct(formData);
    } else {
        messageDiv.textContent = "Uploading...";
        
        try {
            const response = await fetch(`${SERVER_URL}/api/upload`, {
                method: "POST",
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                messageDiv.textContent = "✅ Product uploaded successfully!";
                form.reset();
                loadProducts();
            } else {
                messageDiv.textContent = "❌ Upload failed: " + data.message;
            }
        } catch (error) {
            console.error(error);
            messageDiv.textContent = "❌ Upload error. Check console.";
        }
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

/* ---------------- UPDATE PRODUCT ---------------- */

async function openUpdateForm(productId) {
    currentUpdateId = productId;
    
    // Fetch product details
    try {
        const response = await fetch(`${SERVER_URL}/api/products/${productId}`);
        const data = await response.json();
        
        if (!data.success) {
            messageDiv.textContent = "Failed to load product details";
            return;
        }
        
        const product = data.product;
        
        // Pre-fill the form
        document.getElementById("productName").value = product.product_name;
        document.getElementById("category").value = product.category;
        document.getElementById("brand").value = product.brand;
        document.getElementById("price").value = product.price;
        document.getElementById("stock").value = product.stock;
        document.getElementById("sku").value = product.sku;
        document.getElementById("productClass").value = product.product_class;
        document.getElementById("sizes").value = product.sizes;
        document.getElementById("colors").value = product.colors;
        document.getElementById("description").value = product.description;
        
        // Change form title and button text
        const formTitle = document.querySelector("h2");
        if (formTitle) formTitle.textContent = "Update Product";
        
        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.textContent = "Update Product";
        
        messageDiv.textContent = "Editing product...";
        
        // Scroll to form
        form.scrollIntoView({ behavior: "smooth" });
        
    } catch (error) {
        console.error(error);
        messageDiv.textContent = "Error loading product for update";
    }
}

async function updateProduct(formData) {
    try {
        const response = await fetch(`${SERVER_URL}/api/products/${currentUpdateId}`, {
            method: "PUT",
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageDiv.textContent = "✅ Product updated successfully!";
            form.reset();
            resetFormToUploadMode();
            loadProducts();
        } else {
            messageDiv.textContent = "❌ Update failed: " + data.message;
        }
    } catch (error) {
        console.error(error);
        messageDiv.textContent = "❌ Update error. Check console.";
    }
}

function resetFormToUploadMode() {
    currentUpdateId = null;
    
    const formTitle = document.querySelector("h2");
    if (formTitle) formTitle.textContent = "Upload Product";
    
    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.textContent = "Upload";
    
    messageDiv.textContent = "";
}

/* ---------------- DELETE PRODUCT ---------------- */

async function deleteProduct(productId) {
    if (!confirm("Are you sure you want to delete this product?")) {
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/products/${productId}`, {
            method: "DELETE"
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageDiv.textContent = "✅ Product deleted successfully!";
            loadProducts();
        } else {
            messageDiv.textContent = "❌ Delete failed: " + data.message;
        }
    } catch (error) {
        console.error(error);
        messageDiv.textContent = "❌ Delete error. Check console.";
    }
}

/* ---------------- RENDER PRODUCTS ---------------- */

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
            <button class="update-btn" onclick="openUpdateForm(${p.id})">Update</button>
            <button class="delete-btn" onclick="deleteProduct(${p.id})">Delete</button>
        `;
        
        productList.appendChild(div);
    });
}

// Load products on page load
window.addEventListener("DOMContentLoaded", loadProducts);

