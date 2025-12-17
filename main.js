let products = [];
let currentEditId = null;
let currentImages = [];
let currentView = 'grid';
const API_URL = 'http://localhost:7700/api';

document.addEventListener('DOMContentLoaded', function() {
    loadProducts();
    updateDashboard();
    setupEventListeners();
    populateCategoryFilter();
});

function setupEventListeners() {
    document.getElementById('mobileMenuBtn')?.addEventListener('click', toggleMobileMenu);
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });

    const fileUpload = document.getElementById('fileUpload');
    fileUpload.addEventListener('click', () => document.getElementById('imageInput').click());
    fileUpload.addEventListener('dragover', handleDragOver);
    fileUpload.addEventListener('drop', handleDrop);
    fileUpload.addEventListener('dragleave', handleDragLeave);

    document.getElementById('productModal').addEventListener('click', function(e) {
        if (e.target === this) closeProductModal();
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    document.getElementById('sidebar').classList.remove('open');
}

function toggleMobileMenu() {
    document.getElementById('sidebar').classList.toggle('open');
}

async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error('Failed to fetch products');
        products = await response.json();
        displayProducts();
        updateDashboard();
        populateCategoryFilter();
    } catch (error) {
        console.error('Error loading products:', error);
        showToast('Failed to load products from server', 'error');
        const saved = localStorage.getItem('brightnalProducts');
        products = saved ? JSON.parse(saved) : [];
        displayProducts();
    }
}

function saveProductsToStorage() {
    updateDashboard();
    displayProducts();
}

function displayProducts() {
    const grid = document.getElementById('productsGrid');
    const tableBody = document.getElementById('productsTableBody');
    const emptyState = document.getElementById('emptyState');
    
    let filtered = filterAndSortProducts();

    if (filtered.length === 0) {
        grid.innerHTML = '';
        tableBody.innerHTML = '';
        emptyState.style.display = 'block';
        grid.style.display = 'none';
        document.getElementById('tableView').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';

    if (currentView === 'grid') {
        grid.style.display = 'grid';
        document.getElementById('tableView').style.display = 'none';
        grid.innerHTML = filtered.map(product => createProductCard(product)).join('');
    } else {
        grid.style.display = 'none';
        document.getElementById('tableView').style.display = 'block';
        tableBody.innerHTML = filtered.map(product => createProductRow(product)).join('');
    }
}

function filterAndSortProducts() {
    let filtered = [...products];

    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(searchTerm) ||
            p.description.toLowerCase().includes(searchTerm) ||
            p.category.toLowerCase().includes(searchTerm) ||
            p.sku.toLowerCase().includes(searchTerm)
        );
    }

    const categoryFilter = document.getElementById('categoryFilter').value;
    if (categoryFilter !== 'all') {
        filtered = filtered.filter(p => p.category === categoryFilter);
    }

    const stockFilter = document.getElementById('stockFilter').value;
    if (stockFilter !== 'all') {
        filtered = filtered.filter(p => {
            if (stockFilter === 'in-stock') return p.stock > 10;
            if (stockFilter === 'low-stock') return p.stock > 0 && p.stock <= 10;
            if (stockFilter === 'out-of-stock') return p.stock === 0;
            return true;
        });
    }

    const sortBy = document.getElementById('sortFilter').value;
    filtered.sort((a, b) => {
        switch(sortBy) {
            case 'newest': return new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt);
            case 'oldest': return new Date(a.created_at || a.createdAt) - new Date(b.created_at || b.createdAt);
            case 'name-asc': return a.name.localeCompare(b.name);
            case 'name-desc': return b.name.localeCompare(a.name);
            case 'price-asc': return a.price - b.price;
            case 'price-desc': return b.price - a.price;
            default: return 0;
        }
    });

    return filtered;
}

function searchProducts() {
    displayProducts();
}

function filterProducts() {
    displayProducts();
}

function createProductCard(product) {
    const stockClass = product.stock > 10 ? 'in-stock' : product.stock > 0 ? 'low-stock' : 'out-of-stock';
    const stockText = product.stock > 10 ? 'In Stock' : product.stock > 0 ? 'Low Stock' : 'Out of Stock';
    const image = product.images && product.images.length > 0 ? product.images[0] : '';

    return `
        <div class="product-card" onclick="viewProduct('${product.id}')">
            <div class="product-image">
                ${image ? `<img src="${image}" alt="${product.name}">` : '<div class="product-image-placeholder">📦</div>'}
                <div class="product-actions">
                    <button class="action-btn edit" onclick="event.stopPropagation(); editProduct('${product.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete" onclick="event.stopPropagation(); deleteProduct('${product.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="product-info">
                <div class="product-category">${product.category}</div>
                <div class="product-name">${product.name}</div>
                <div class="product-description">${product.description}</div>
                <div class="product-footer">
                    <div class="product-price">$${product.price.toFixed(2)}</div>
                    <div class="product-stock ${stockClass}">${stockText}</div>
                </div>
            </div>
        </div>
    `;
}

function createProductRow(product) {
    const stockClass = product.stock > 10 ? 'in-stock' : product.stock > 0 ? 'low-stock' : 'out-of-stock';
    const stockText = product.stock > 10 ? 'In Stock' : product.stock > 0 ? 'Low Stock' : 'Out of Stock';
    const image = product.images && product.images.length > 0 ? product.images[0] : '';

    return `
        <tr>
            <td>
                <div class="table-product-info">
                    <div class="table-product-image">
                        ${image ? `<img src="${image}" alt="${product.name}">` : '📦'}
                    </div>
                    <div class="table-product-details">
                        <div class="table-product-name">${product.name}</div>
                        <div class="table-product-sku">${product.sku}</div>
                    </div>
                </div>
            </td>
            <td>${product.category}</td>
            <td><strong>$${product.price.toFixed(2)}</strong></td>
            <td>${product.stock}</td>
            <td><span class="product-stock ${stockClass}">${stockText}</span></td>
            <td>
                <div class="table-actions">
                    <button class="btn btn-sm btn-secondary" onclick="editProduct('${product.id}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `;
}

function toggleView() {
    currentView = currentView === 'grid' ? 'table' : 'grid';
    document.getElementById('viewToggleText').textContent = currentView === 'grid' ? 'Table View' : 'Grid View';
    displayProducts();
}

function openProductModal(editId = null) {
    currentEditId = editId;
    currentImages = [];
    
    const modal = document.getElementById('productModal');
    const form = document.getElementById('productForm');
    const modalTitle = document.getElementById('modalTitle');
    const saveButton = document.getElementById('saveButtonText');

    form.reset();
    document.getElementById('filePreview').innerHTML = '';

    if (editId) {
        const product = products.find(p => p.id === editId);
        if (product) {
            modalTitle.textContent = 'Edit Product';
            saveButton.textContent = 'Update Product';
            document.getElementById('productName').value = product.name;
            document.getElementById('productDescription').value = product.description;
            document.getElementById('productCategory').value = product.category;
            document.getElementById('productPrice').value = product.price;
            document.getElementById('productStock').value = product.stock;
            document.getElementById('productSKU').value = product.sku;
            currentImages = product.images || [];
            displayImagePreviews();
        }
    } else {
        modalTitle.textContent = 'Add New Product';
        saveButton.textContent = 'Save Product';
    }

    modal.classList.add('active');
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
    currentEditId = null;
    currentImages = [];
}

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                currentImages.push(e.target.result);
                displayImagePreviews();
            };
            reader.readAsDataURL(file);
        }
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                currentImages.push(e.target.result);
                displayImagePreviews();
            };
            reader.readAsDataURL(file);
        }
    });
}

function displayImagePreviews() {
    const preview = document.getElementById('filePreview');
    preview.innerHTML = currentImages.map((img, index) => `
        <div class="preview-item">
            <img src="${img}" alt="Preview ${index + 1}">
            <button class="preview-remove" onclick="removeImage(${index})" type="button">✕</button>
        </div>
    `).join('');
}

function removeImage(index) {
    currentImages.splice(index, 1);
    displayImagePreviews();
}

async function saveProduct(event) {
    event.preventDefault();

    const productData = {
        name: document.getElementById('productName').value,
        description: document.getElementById('productDescription').value,
        category: document.getElementById('productCategory').value,
        price: parseFloat(document.getElementById('productPrice').value),
        stock: parseInt(document.getElementById('productStock').value),
        sku: document.getElementById('productSKU').value || 'SKU-' + Date.now(),
        images: currentImages
    };

    try {
        let response;
        
        if (currentEditId) {
            response = await fetch(`${API_URL}/products/${currentEditId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(productData)
            });
            
            if (!response.ok) throw new Error('Failed to update product');
            showToast('Product updated successfully!', 'success');
        } else {
            response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(productData)
            });
            
            if (!response.ok) throw new Error('Failed to create product');
            showToast('Product added successfully!', 'success');
        }

        await loadProducts();
        closeProductModal();
        
    } catch (error) {
        console.error('Error saving product:', error);
        showToast('Failed to save product: ' + error.message, 'error');
    }
}

function editProduct(id) {
    openProductModal(id);
}

async function deleteProduct(id) {
    if (confirm('Are you sure you want to delete this product?')) {
        try {
            const response = await fetch(`${API_URL}/products/${id}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete product');
            
            await loadProducts();
            showToast('Product deleted successfully!', 'success');
        } catch (error) {
            console.error('Error deleting product:', error);
            showToast('Failed to delete product: ' + error.message, 'error');
        }
    }
}

function viewProduct(id) {
    editProduct(id);
}

function updateDashboard() {
    const totalProducts = products.length;
    const totalValue = products.reduce((sum, p) => sum + (p.price * p.stock), 0);
    const inStockCount = products.filter(p => p.stock > 0).length;
    const categories = [...new Set(products.map(p => p.category))].length;

    document.getElementById('totalProducts').textContent = totalProducts;
    document.getElementById('productsCount').textContent = totalProducts;
    document.getElementById('totalValue').textContent = '$' + totalValue.toFixed(2);
    document.getElementById('inStockCount').textContent = inStockCount;
    document.getElementById('categoriesCount').textContent = categories;
}

function populateCategoryFilter() {
    const categories = [...new Set(products.map(p => p.category))];
    const filter = document.getElementById('categoryFilter');
    const currentValue = filter.value;
    
    filter.innerHTML = '<option value="all">All Categories</option>' +
        categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    
    filter.value = currentValue;
}

async function exportData() {
    try {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error('Failed to fetch products');
        const products = await response.json();
        
        const dataStr = JSON.stringify(products, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'brightnal-products-' + new Date().toISOString().split('T')[0] + '.json';
        link.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully!', 'success');
    } catch (error) {
        console.error('Error exporting data:', error);
        showToast('Failed to export data', 'error');
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
