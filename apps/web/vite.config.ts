import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function wasmHotRebuild(): PluginOption {
  const wasmCrate = path.resolve(__dirname, '../../rectify-wasm');
  const outDir = path.resolve(__dirname, 'src/wasm-pkg');

  let building = false;
  let pendingRebuild = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function rebuild(server: import('vite').ViteDevServer) {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;
    const cmd = `wasm-pack build ${wasmCrate} --target web --out-dir ${outDir}`;
    server.config.logger.info('\x1b[36m[wasm] Rebuilding...\x1b[0m');
    const start = Date.now();
    exec(cmd, (error, _stdout, stderr) => {
      building = false;
      const elapsed = Date.now() - start;
      if (error) {
        server.config.logger.error(`\x1b[31m[wasm] Build failed (${elapsed}ms)\x1b[0m`);
        server.config.logger.error(stderr);
      } else {
        server.config.logger.info(`\x1b[32m[wasm] Built (${elapsed}ms)\x1b[0m`);
        server.ws.send({ type: 'full-reload', path: '*' });
      }
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild(server);
      }
    });
  }

  return {
    name: 'wasm-hot-rebuild',
    apply: 'serve',
    configureServer(server) {
      const watchRoots = [
        path.resolve(__dirname, '../../rectify-core/src'),
        path.resolve(__dirname, '../../rectify-wasm/src'),
      ];
      for (const root of watchRoots) {
        if (!fs.existsSync(root)) continue;
        fs.watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          if (!filename.endsWith('.rs') && !filename.endsWith('Cargo.toml')) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            server.config.logger.info(`\x1b[36m[wasm] Change: ${filename}\x1b[0m`);
            rebuild(server);
          }, 150);
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), wasmHotRebuild()],
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      // Allow reading sample images from the repo's `examples/` directory.
      allow: [
        path.resolve(__dirname, '..', '..'),
      ],
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  optimizeDeps: {
    exclude: ['rectify-wasm'],
  },
});
