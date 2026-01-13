import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');

  // Check multiple common names for the API Key to be helpful
  const apiKey = 
    process.env.API_KEY || 
    process.env.VITE_API_KEY || 
    process.env.GOOGLE_API_KEY || 
    process.env.GEMINI_API_KEY || 
    env.API_KEY || 
    env.VITE_API_KEY || 
    env.GOOGLE_API_KEY ||
    "";

  // Log status during build for debugging (Netlify Deploy Logs)
  if (!apiKey) {
      console.warn("⚠️  WARNING: API_KEY is missing in the build environment! The app will not function correctly.");
  } else {
      console.log(`✅ API_KEY found (length: ${apiKey.length})`);
  }

  return {
    plugins: [react()],
    define: {
      // We inject the found key into 'process.env.API_KEY' so the app always finds it there
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
    build: {
      target: 'esnext'
    }
  };
});