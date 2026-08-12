import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,       // accept LAN connections (phone reaches us for QR sideload)
    port: 5173,
    strictPort: true, // QR codes embed the port — fail loudly rather than drift
    // For hardware day, pin HMR to the LAN IP so the phone's WebView can
    // reach the HMR websocket (localhost would be unreachable from the phone):
    // hmr: { host: '<your-lan-ip>' },
  },
})
