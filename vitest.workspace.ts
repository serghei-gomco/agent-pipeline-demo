import react from '@vitejs/plugin-react';
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'server', include: ['server/test/**/*.test.ts'], environment: 'node' } },
  {
    plugins: [react()],
    test: {
      name: 'web',
      include: ['web/src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['web/test-setup.ts'],
    },
  },
]);
