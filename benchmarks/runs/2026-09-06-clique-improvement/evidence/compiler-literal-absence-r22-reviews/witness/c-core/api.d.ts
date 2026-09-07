import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, VideoAsset } from 'snapback2';
import type { Channel, Op } from 'snapback2/client';

type ConnectedRow = {
  id: string;
  principal: Principal;
  value: number;
};
type RecordsRow = {
  id: string;
  length: number;
  label: string;
  payload: Json;
};

declare module 'snapback2/client' {
  interface Api {
    readonly probe: {
      readonly probe: Op<{}, { original: (number | null)[]; next: string; }>;
    };
  }
}

export {};
