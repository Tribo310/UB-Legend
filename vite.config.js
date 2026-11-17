import { defineConfig } from 'vite';

// Vite тохиргоо.
//   npm run dev     — хөгжүүлэлтийн сервер (http://localhost:5173)
//   npm run build   — dist/ хавтаст бэлэн (оновчилсон) хувилбар
export default defineConfig({
  // Харьцангуй зам: dist/ хавтсыг дурын хаяг, дэд хавтаст байршуулж болно
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    // Rapier-ийн WASM нь JS файл дотор (base64) суусан тул chunk том (~5 МБ, gzip ~1.8 МБ).
    // Үе шат 10-ын оновчлолд WASM-ийг тусдаа файлаар ачаалдаг хувилбар руу шилжүүлж болно.
    chunkSizeWarningLimit: 6000,
  },
});
