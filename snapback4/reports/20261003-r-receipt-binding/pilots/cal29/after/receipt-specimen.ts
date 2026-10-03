import {usePage,useSeen} from 'snapback4/react';
import {api} from './snapback/generated/api';
declare const id:string,foreground:boolean,routeFocused:boolean;
declare const viewport:{y:number,height:number},bounds:Record<string,{y:number,height:number}>;
const page=usePage(api.history,{conversation:id});
 const newest=Math.max(0,...page.items.filter(x=>!x.pending&&bounds[x.id]&&viewport.height>0&&bounds[x.id].y<viewport.y+viewport.height&&bounds[x.id].y+bounds[x.id].height>viewport.y).map(x=>x.ordinal));
 useSeen(api.receiptFamilies.chat,{scope:id,through:newest,active:foreground&&routeFocused});
// @ts-expect-error generated seen arguments remain typed
api.receiptFamilies.chat.seen.args = {scope:3};
