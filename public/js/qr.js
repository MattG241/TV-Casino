// Simple QR code rendering via canvas using Google Charts-style API image
// Falls back to displaying the URL text if image fails to load

const QRCode = {
  render(canvas, text) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // Use a public QR code API
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      // Fallback: just show the URL as text
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Scan not available', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText('Use code instead', canvas.width / 2, canvas.height / 2 + 15);
    };
  }
};
