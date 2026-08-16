import { useSnapbackMedia } from '@expo/snapback-react';

// A handler/storage value is only the physical asset-id string. It must not
// cross the result-projection boundary as though it were a public MediaRef.
useSnapbackMedia('physical-asset-id');
