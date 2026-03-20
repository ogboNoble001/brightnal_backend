const SERVER_URL = "https://brightnal.onrender.com";

let currentUpdateId = null;

const form        = document.getElementById("uploadForm");
const messageDiv  = document.getElementById("message");
const productList = document.getElementById("productList");
const loadBtn     = document.getElementById("loadProductsBtn");
const formTitle   = document.getElementById("formTitle");
const submitBtn   = document.getElementById("submitBtn");
const cancelBtn   = document.getElementById("cancelUpdateBtn");

/* ---------------- UPLOAD / CREATE ---------------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (currentUpdateId) {
    messageDiv.textContent = "Updating...";
    await updateProduct(new FormData(form));
    return;
  }

  if (!document.getElementById("imageInput").files.length) {
    messageDiv.textContent = "⚠️ Please select an image.";
    return;
  }

  messageDiv.textContent = "Uploading...";

  try {
    const res  = await fetch(`${SERVER_URL}/api/products`, {
      method: "POST",
      body: new FormData(form),
    });
    const data = await res.json();

    if (data.success) {
      messageDiv.textContent = "✅ Product uploaded successfully!";
      form.reset();
      loadProducts();
    } else {
      messageDiv.textContent = "❌ Upload failed: " + data.message;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Upload error. Check console.";
  }
});

/* ---------------- GET ALL PRODUCTS (admin — no limit) ---------------- */

loadBtn.addEventListener("click", loadProducts);

async function loadProducts() {
  productList.innerHTML = "Loading products...";

  try {
    const res  = await fetch(`${SERVER_URL}/api/products/all`);
    const data = await res.json();

    if (!data.success) {
      productList.textContent = "Failed to load products.";
      return;
    }

    renderProducts(data.products);
  } catch (err) {
    console.error(err);
    productList.textContent = "Error loading products.";
  }
}

/* ---------------- UPDATE PRODUCT ---------------- */

async function openUpdateForm(productId) {
  try {
    const res  = await fetch(`${SERVER_URL}/api/products/${productId}`);
    const data = await res.json();

    if (!data.success) {
      messageDiv.textContent = "Failed to load product details.";
      return;
    }

    const p = data.product;

    document.getElementById("productName").value  = p.product_name  || "";
    document.getElementById("category").value     = p.category      || "";
    document.getElementById("brand").value        = p.brand         || "";
    document.getElementById("price").value        = p.price         || "";
    document.getElementById("stock").value        = p.stock         || "";
    document.getElementById("sku").value          = p.sku           || "";
    document.getElementById("productClass").value = p.product_class || "";
    document.getElementById("sizes").value        = p.sizes         || "";
    document.getElementById("colors").value       = p.colors        || "";
    document.getElementById("description").value  = p.description   || "";

    currentUpdateId         = productId;
    formTitle.textContent   = "Update Product";
    submitBtn.textContent   = "Update Product";
    cancelBtn.style.display = "inline-block";
    messageDiv.textContent  = "Editing product...";

    form.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "Error loading product for update.";
  }
}

async function updateProduct(formData) {
  try {
    const res  = await fetch(`${SERVER_URL}/api/products/${currentUpdateId}`, {
      method: "PUT",
      body: formData,
    });
    const data = await res.json();

    if (data.success) {
      messageDiv.textContent = "✅ Product updated successfully!";
      form.reset();
      resetFormToUploadMode();
      loadProducts();
    } else {
      messageDiv.textContent = "❌ Update failed: " + data.message;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Update error. Check console.";
  }
}

cancelBtn.addEventListener("click", () => {
  form.reset();
  resetFormToUploadMode();
  messageDiv.textContent = "";
});

function resetFormToUploadMode() {
  currentUpdateId         = null;
  formTitle.textContent   = "Upload Product";
  submitBtn.textContent   = "Upload Product";
  cancelBtn.style.display = "none";
}

/* ---------------- DELETE PRODUCT ---------------- */

async function deleteProduct(productId) {
  if (!confirm("Are you sure you want to delete this product?")) return;

  try {
    const res  = await fetch(`${SERVER_URL}/api/products/${productId}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (data.success) {
      messageDiv.textContent = "✅ Product deleted successfully!";
      loadProducts();
    } else {
      messageDiv.textContent = "❌ Delete failed: " + data.message;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Delete error. Check console.";
  }
}

/* ---------------- RENDER PRODUCTS ---------------- */

function renderProducts(products) {
  if (!products.length) {
    productList.innerHTML = "<p>No products found.</p>";
    return;
  }

  productList.innerHTML = "";

  products.forEach((p) => {
    const div = document.createElement("div");
    div.className = "product";
    div.innerHTML = `
      <img src="${p.image_url}" alt="${p.product_name}" />
      <div class="product-info">
        <strong>${p.product_name}</strong><br/>
        ₦${Number(p.price).toLocaleString()} &nbsp;•&nbsp; Stock: ${p.stock}<br/>
        <span style="color:#888;font-size:13px;">${p.category}${p.brand ? " • " + p.brand : ""}</span>
      </div>
      <div class="product-actions">
        <button class="update-btn" onclick="openUpdateForm(${p.id})">Edit</button>
        <button class="delete-btn" onclick="deleteProduct(${p.id})">Delete</button>
      </div>
    `;
    productList.appendChild(div);
  });
}

/* ---------------- INIT ---------------- */

window.openUpdateForm = openUpdateForm;
window.deleteProduct  = deleteProduct;

window.addEventListener("DOMContentLoaded", loadProducts);
