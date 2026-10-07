import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({plugins:[react()],optimizeDeps:{force:true},resolve:{dedupe:['react','react-dom'],alias:{react:resolve(import.meta.dirname,'node_modules/react'),'react-dom':resolve(import.meta.dirname,'node_modules/react-dom')}},build:{target:'es2022'}});
