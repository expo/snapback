import { createClient } from 'snapback3/client';
import { Platform } from 'react-native';
// S3 supplies browser persistence; native storage is not available in this slice.
export const client = createClient({url: Platform.OS === 'web' ? window.location.origin : 'http://127.0.0.1:54800', ...(Platform.OS === 'web' ? {} : {storage:false})});
