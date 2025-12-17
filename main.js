const form = document.getElementById('uploadForm');
const messageDiv = document.getElementById('message');

// Replace this with your actual Render URL
const SERVER_URL = 'https://brightnal.onrender.com';

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    messageDiv.textContent = 'Uploading...';
    
    const formData = new FormData(form);
    
    try {
        const response = await fetch(`${SERVER_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Server returned HTML/Text:', text);
            messageDiv.textContent = '❌ Server error. Check browser console (F12) for details.';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            messageDiv.textContent = '✅ Product uploaded successfully!';
            form.reset();
        } else {
            messageDiv.textContent = '❌ Upload failed: ' + data.message;
        }
    } catch (error) {
        console.error('Full error:', error);
        messageDiv.textContent = '❌ Error: ' + error.message + ' (Check console F12)';
    }
});