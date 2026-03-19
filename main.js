const SERVER_URL = "https://brightnal.onrender.com";

// ============================================
// STATE
// ============================================

let currentUpdateId = null;
let token = localStorage.getItem("brightnal_token") || null;

// ============================================
// DOM REFS
// ============================================

const authSection    = document.getElementById("authSection");
const authStatus     = document.getElementById("authStatus");
const authMessage    = document.getElementById("authMessage");
const loggedInAs     = document.getElementById("loggedInAs");
const productSection = document.getElementById("productSection");
const productsArea   = document.getElementById("productsArea");

const loginBtn       = document.getElementById("loginBtn");
const registerBtn    = document.getElementById("registerBtn");
const logoutBtn      = document.getElementById("logoutBtn");

const form           = document.getElementById("uploadForm");
const formTitle      = document.getElementById("formTitle");
const submitBtn      = document.getElementById("submitBtn");
const cancelUpdateBtn = document.getElementById("cancelUpdateBtn");
const messageDiv     = document.getElementById("message");
const productList    = document.getElementById("productList");

// ============================================
// AUTH HELPERS
// ============================================

// Returns headers with Authorization if token exists
function authHeaders(extra = {}) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function saveToken(t) {
  token = t;
  localStorage.setItem("brightnal_token", t);
}

function clearToken() {
  token = null;
  localStorage.removeItem("brightnal_token");
}

function showLoggedIn(email) {
  authSection.style.display = "none";
  authStatus.style.display = "flex";
  productSection.style.display = "block";
  productsArea.style.display = "block";
  loggedInAs.textContent = `✅ Logged in as ${email}`;
  loadProducts();
}

function showLoggedOut() {
  authSection.style.display = "block";
  authStatus.style.display = "none";
  productSection.style.display = "none";
  productsArea.style.display = "none";
}

// ============================================
// AUTH ROUTES
// ============================================

loginBtn.addEventListener("click", async () => {
  const email    = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  if (!email || !password) {
    authMessage.textContent = "⚠️ Email and password required";
    return;
  }

  authMessage.textContent = "Logging in...";

  try {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (data.success) {
      saveToken(data.token);
      authMessage.textContent = "";
      showLoggedIn(data.user.email);
    } else {
      authMessage.textContent = `❌ ${data.message}`;
    }
  } catch (err) {
    console.error(err);
    authMessage.textContent = "❌ Login failed. Check connection.";
  }
});

registerBtn.addEventListener("click", async () => {
  const full_name = document.getElementById("authName").value.trim();
  const email     = document.getElementById("authEmail").value.trim();
  const password  = document.getElementById("authPassword").value;

  if (!email || !password) {
    authMessage.textContent = "⚠️ Email and password required";
    return;
  }

  authMessage.textContent = "Creating account...";

  try {
    const res = await fetch(`${SERVER_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name }),
    });

    const data = await res.json();

    if (data.success) {
      saveToken(data.token);
      authMessage.textContent = "";
      showLoggedIn(data.user.email);
    } else {
      authMessage.textContent = `❌ ${data.message}`;
    }
  } catch (err) {
    console.error(err);
    authMessage.textContent = "❌ Registration failed. Check connection.";
  }
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  showLoggedOut();
});

// ============================================
// GET ALL PRODUCTS (PUBLIC)
// ============================================

async function loadProducts() {
  productList.innerHTML = "Loading products...";

  try {
    const res  = await fetch(`${SERVER_URL}/api/products`);
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

// ============================================
// CREATE PRODUCT (PROTECTED)
// ============================================

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (currentUpdateId) {
    messageDiv.textContent = "Updating...";
    await updateProduct(new FormData(form));
    return;
  }

  const imageInput = document.getElementById("imageInput");
  if (!imageInput.files.length) {
    messageDiv.textContent = "⚠️ Please select an image.";
    return;
  }

  messageDiv.textContent = "Uploading...";

  try {
    const res = await fetch(`${SERVER_URL}/api/products`, {
      method: "POST",
      headers: authHeaders(), // NO Content-Type — browser sets it with boundary for FormData
      body: new FormData(form),
    });

    const data = await res.json();

    if (res.status === 401) {
      handleExpiredToken();
      return;
    }

    if (data.success) {
      messageDiv.textContent = "✅ Product uploaded successfully!";
      form.reset();
      loadProducts();
    } else {
      messageDiv.textContent = `❌ Upload failed: ${data.message}`;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Upload error. Check console.";
  }
});

// ============================================
// UPDATE PRODUCT (PROTECTED)
// ============================================

async function openUpdateForm(productId) {
  try {
    const res  = await fetch(`${SERVER_URL}/api/products/${productId}`);
    const data = await res.json();

    if (!data.success) {
      messageDiv.textContent = "❌ Failed to load product";
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

    currentUpdateId = productId;
    formTitle.textContent     = "Update Product";
    submitBtn.textContent     = "Save Changes";
    cancelUpdateBtn.style.display = "inline-block";
    messageDiv.textContent    = `Editing: ${p.product_name}`;

    form.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Error loading product.";
  }
}

async function updateProduct(formData) {
  try {
    const res = await fetch(`${SERVER_URL}/api/products/${currentUpdateId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: formData,
    });

    const data = await res.json();

    if (res.status === 401) {
      handleExpiredToken();
      return;
    }

    if (data.success) {
      messageDiv.textContent = "✅ Product updated successfully!";
      form.reset();
      resetFormToUploadMode();
      loadProducts();
    } else {
      messageDiv.textContent = `❌ Update failed: ${data.message}`;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Update error. Check console.";
  }
}

cancelUpdateBtn.addEventListener("click", () => {
  form.reset();
  resetFormToUploadMode();
  messageDiv.textContent = "";
});

function resetFormToUploadMode() {
  currentUpdateId = null;
  formTitle.textContent         = "Upload Product";
  submitBtn.textContent         = "Upload Product";
  cancelUpdateBtn.style.display = "none";
}

// ============================================
// DELETE PRODUCT (PROTECTED)
// ============================================

async function deleteProduct(productId) {
  if (!confirm("Delete this product? This cannot be undone.")) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/products/${productId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const data = await res.json();

    if (res.status === 401) {
      handleExpiredToken();
      return;
    }

    if (data.success) {
      messageDiv.textContent = "✅ Product deleted.";
      loadProducts();
    } else {
      messageDiv.textContent = `❌ Delete failed: ${data.message}`;
    }
  } catch (err) {
    console.error(err);
    messageDiv.textContent = "❌ Delete error. Check console.";
  }
}

// ============================================
// RENDER PRODUCTS
// ============================================

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
        <span style="color:#888;font-size:13px;">${p.category} ${p.brand ? `• ${p.brand}` : ""}</span>
      </div>
      ${token ? `
      <div class="product-actions">
        <button class="update-btn" onclick="openUpdateForm(${p.id})">Edit</button>
        <button class="delete-btn" onclick="deleteProduct(${p.id})">Delete</button>
      </div>` : ""}
    `;

    productList.appendChild(div);
  });
}

// ============================================
// TOKEN EXPIRY HANDLER
// ============================================

function handleExpiredToken() {
  clearToken();
  showLoggedOut();
  authMessage.textContent = "⚠️ Session expired. Please log in again.";
}

// ============================================
// INIT — restore session on page load
// ============================================

async function init() {
  if (!token) {
    showLoggedOut();
    return;
  }

  // Verify token is still valid
  try {
    const res  = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: authHeaders(),
    });
    const data = await res.json();

    if (data.success) {
      showLoggedIn(data.user.email);
    } else {
      clearToken();
      showLoggedOut();
    }
  } catch {
    // Network error — still show logged in state if token exists
    showLoggedIn("(cached session)");
  }
}

window.addEventListener("DOMContentLoaded", init);

// Expose to onclick handlers in HTML
window.openUpdateForm = openUpdateForm;
window.deleteProduct  = deleteProduct;
