import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: {
        adapter: adapter({
            // Default options:
            pages: 'build', // Directory where your static files will be generated
            assets: 'build', // Directory for static assets
            fallback: 'index.html',
            precompress: false // Enable gzip/brotli compression (optional)
        }),
	}
};

export default config;
