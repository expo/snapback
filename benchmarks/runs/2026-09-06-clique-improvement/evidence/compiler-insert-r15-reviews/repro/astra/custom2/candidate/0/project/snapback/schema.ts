import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{d3:t.optional(t.decimal(3)),payload:t.optional(t.json(10000))},indexes:{byD3:{columns:["d3"],unique:true}},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});