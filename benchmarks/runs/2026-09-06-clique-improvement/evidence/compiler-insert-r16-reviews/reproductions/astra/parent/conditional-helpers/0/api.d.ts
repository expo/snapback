import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, VideoAsset } from 'snapback2';
import type { Channel, Op } from 'snapback2/client';

type RecordsRow = {
  id: string;
  payload?: Json;
};

declare module 'snapback2/client' {
  interface Api {
    readonly probe: {
      readonly probe: Op<{ flag: boolean }, { row: { id: string; } & {} & { readonly payload?: any; }; stored: RecordsRow | null; next: string }>;
    };
  }
}

export {};
