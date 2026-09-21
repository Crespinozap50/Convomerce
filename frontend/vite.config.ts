import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Acceso remoto (ngrok/Tailscale): `allowedHosts` deja pasar el dominio del túnel y
// `proxy` reenvía /v1 al backend local, así el navegador remoto solo habla con este
// origen (sin CORS ni cookies cross-site). Usar con VITE_API_URL="" (rutas relativas).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // El backend solo acepta CORS desde localhost:5173: como el navegador remoto
        // envía el dominio del túnel como Origin, se reescribe aquí (solo desarrollo).
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', 'http://localhost:5173'));
        },
      },
    },
  },
});
