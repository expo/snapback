import {existence} from 'snapback4/contract';
import {usePage} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './direct-notice';
const page=usePage(api.searchMessages,{q:''});

function Widget(props:{loading:boolean;emptyText:string}){return null;}
export const result=<><Widget loading={existence(page.read)==='loading'} emptyText={existence(page.read)==='absent'?'No results':''}/><ReadNotice read={page.read}/></>;
