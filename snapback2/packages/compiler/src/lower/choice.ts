import type ts from "typescript";
import type { Expr } from "../ir";
import { literal, temporary } from "../syntax";
import type { Environment, LoweredValue } from "./environment";
import { cloneEnvironment } from "./expr";
import { captureTupleValues } from "./value-conversion";

type LowerValue = (node:ts.Expression,env:Environment,hint?:string)=>LoweredValue;
export function lowerConditionalValue(node:ts.ConditionalExpression, env:Environment, lower:LowerValue, hint?:string):LoweredValue {
  const name=temporary(env,"conditional"), selected=temporary(env,"selected");
  const condition=lower(node.condition,env);
  const yes=lower(node.whenTrue,cloneEnvironment(env),hint), no=lower(node.whenFalse,cloneEnvironment(env),hint);
  yes.expression=captureTupleValues(yes,env); no.expression=captureTupleValues(no,env);
  const choice={condition:{Variable:selected} satisfies Expr,whenTrue:yes.expression,whenFalse:no.expression};
  env.runtimeBindings.set(name,{provenance:"Const",choice});
  return {statements:[...condition.statements,{Const:{name:selected,value:condition.expression}},{Let:{name,value:literal(null)}},
    {If:{condition:choice.condition,then_body:[...yes.statements,{Assign:{name,value:yes.expression}}],else_body:[...no.statements,{Assign:{name,value:no.expression}}]}}],expression:{Variable:name}};
}
export function lowerLogicalValue(left:LoweredValue,right:LoweredValue,op:"And"|"Or"|"Nullish",env:Environment):LoweredValue {
  const leftName=temporary(env,"logicalLeft"),result=temporary(env,"logicalResult");
  left.expression=captureTupleValues(left,env); right.expression=captureTupleValues(right,env);
  const condition:Expr=op==="Nullish"?{Binary:{op:"Eq",left:{Variable:leftName},right:literal(null)}}
    :op==="And"?{Variable:leftName}:{Unary:{op:"Not",value:{Variable:leftName}}};
  env.runtimeBindings.set(leftName,{provenance:"Const",capturedShape:left.expression});
  env.runtimeBindings.set(result,{provenance:"Const",choice:{condition,whenTrue:right.expression,whenFalse:{Variable:leftName},nullish:op==="Nullish"}});
  return {statements:[...left.statements,{Let:{name:leftName,value:left.expression}},{Let:{name:result,value:{Variable:leftName}}},
    {If:{condition,then_body:[...right.statements,{Assign:{name:result,value:right.expression}}],else_body:[]}}],expression:{Variable:result}};
}
