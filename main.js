const form = document.getElementById('uploadForm');
const messageDiv = document.getElementById('message');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    messageDiv.textContent = 'Uploading...';
    
    const formData = new FormData(form);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageDiv.textContent = '✅ Product uploaded successfully!';
            form.reset();
        } else {
            messageDiv.textContent = '❌ Upload failed: ' + data.message;
        }
    } catch (error) {
        messageDiv.textContent = '❌ Error: ' + error.message;
    }
});