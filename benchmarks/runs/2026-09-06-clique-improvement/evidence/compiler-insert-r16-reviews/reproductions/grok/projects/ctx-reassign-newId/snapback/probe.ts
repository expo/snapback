import {mutation,t,divmod} from 'snapback2';import {records} from './schema';
export const probe=mutation({payload:t.json(100)},({db,ctx,args})=>{ctx=args.payload as any;return ctx.newId();});