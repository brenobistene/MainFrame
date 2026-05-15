import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest config — separado do vite.config.ts pra evitar carregar
 * tailwind/plugins de UI durante testes (puro Node, sem build pipeline
 * de produção). React plugin é mantido pra suportar testes que renderizam
 * componentes (mesmo que a maioria seja de funções puras).
 *
 * Scripts:
 *   npm test            → roda suite uma vez
 *   npm run test:watch  → watch mode
 *   npm run test:ui     → interface visual
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Foco em código nosso, não em libs/build/fixtures de teste.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',  // bootstrap, sem lógica
        'src/types.ts',  // só types
      ],
    },
  },
})
