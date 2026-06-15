import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://wayfield.dev',
  base: '/',
  integrations: [tailwind()],
  output: 'static'
});
