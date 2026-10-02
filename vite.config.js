import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // 빌드 결과를 어느 경로에 올려도 동작하도록
  build: {
    chunkSizeWarningLimit: 1000, // Three.js 자체가 500kB를 넘으므로 경고 기준 상향
  },
});
