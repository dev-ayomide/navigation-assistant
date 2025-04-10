import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", 
    port: 5173,
    allowedHosts: [
      '3709-102-89-82-213.ngrok-free.app' 
    ]
  },
})