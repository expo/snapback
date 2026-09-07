import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, VideoAsset } from 'snapback2';
import type { Channel, Op } from 'snapback2/client';

type ConnectedRow = {
  id: string;
  principal: Principal;
  value: number;
};
type TodosRow = {
  id: string;
  title: string;
  done: boolean;
  ownerId: Principal;
};

declare module 'snapback2/client' {
  interface Api {
    readonly todos: {
      readonly add: Op<{ done?: boolean | null }, { row: RowOfColumns<{ readonly title: Column<string, false>; readonly done: Column<boolean, false>; readonly ownerId: Column<Principal, false>; }>; next: string; }>;
    };
  }
}

export {};
