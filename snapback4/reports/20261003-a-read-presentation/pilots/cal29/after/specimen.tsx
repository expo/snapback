import {readPresentation} from 'snapback4/contract';
import {usePage} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './src/ReadNotice';
const page=usePage(api.searchMessages,{q:''});
const status=readPresentation(page.read);
function Widget(props:{loading:boolean;emptyText:string}){return null;}
export const result=<><Widget loading={status.pending} emptyText={status.existence==='absent'?'No results':''}/><ReadNotice status={status}/></>;
