// QR code rendering — uses local /api/qr endpoint (no external dependencies)
const QRCode = {
  render(canvas, text) {
    const url = `/api/qr?data=${encodeURIComponent(text)}`;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      // Fallback: show the URL as text
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Use code to join:', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(text.split('room=')[1] || text, canvas.width / 2, canvas.height / 2 + 15);
    };
    img.src = url;
  }
};
