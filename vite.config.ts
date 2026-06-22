import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    viteReact(),
  ],
  // Set this to your GitHub repo name if deploying to:
  // https://<username>.github.io/<repo-name>/
  // Leave as '/' if deploying to a custom domain or user/org page
  base: '/tryhard-farmako/',
})
