import Lean.Data.Json
import Quarry.Run
import Quarry.Json

/-!
# Cases and outcomes as tagged JSON (the oracle's I/O)

The emitter (`snapback4-lang/src/emit/lean.rs`) writes a case as one JSON
object; `quarry-oracle` (`Oracle.lean`) decodes it here, calls `run` and
prints the outcome with `outcomeTagged`. This file is input and output
only: it adds no semantics, and nothing in it is used by a proof.

The format is the README's ("The case format"):

* **Scalars are tagged**: `{"null":null}`, `{"bool":b}`, `{"int":"…"}`
  (a decimal string), `{"text":"…"}`, `{"id":"…"}`, `{"bytes":"hex"}`.
  Values add `{"arr":[…]}` and `{"row":[[name, value], …]}` (ordered pairs,
  because the model's row equality is ordered).
* **One key per constructor** of `Syntax.lean` for rules, terms,
  expressions, statements and writes.
* **Store rows** are `{"id":"…","cols":{name: scalar}}`; columns are put in
  the table's declared order, and an absent column is null.

Unlike `Outcome.toJson` (`Json.lean`), which prints ids and text alike as on
the wire, `outcomeTagged` keeps every scalar tagged, so the harness can
compare an id with an id and a text with a text (OPEN V1).
-/

namespace Quarry.CaseJson
open Lean (Json)
open Quarry

abbrev D := Except String

def field (j : Json) (k : String) : D Json := j.getObjVal? k
def str (j : Json) (k : String) : D String := do (← field j k).getStr?
def arr (j : Json) (k : String) : D (Array Json) := do (← field j k).getArr?
def optField (j : Json) (k : String) : Option Json :=
  match j.getObjVal? k with
  | .ok .null => none
  | .ok v => some v
  | .error _ => none

/-- The single key of a one-key object, and its value. -/
def tag (j : Json) : D (String × Json) := do
  let kvs ← j.getObj?
  match kvs.toList with
  | [(k, v)] => pure (k, v)
  | _ => throw s!"expected a one-key object, got {j.compress}"

def pair (j : Json) : D (Json × Json) := do
  let xs ← j.getArr?
  if h : xs.size = 2 then pure (xs[0], xs[1]) else throw s!"expected a pair, got {j.compress}"

def triple (j : Json) : D (Json × Json × Json) := do
  let xs ← j.getArr?
  if h : xs.size = 3 then pure (xs[0], xs[1], xs[2]) else throw s!"expected a triple, got {j.compress}"

def hexVal (c : Char) : D Nat :=
  if '0' ≤ c && c ≤ '9' then pure (c.toNat - 48)
  else if 'a' ≤ c && c ≤ 'f' then pure (c.toNat - 87)
  else throw s!"bad hex digit {c}"

def hexBytes : List Char → D (List Nat)
  | [] => pure []
  | a :: b :: rest => do return ((← hexVal a) * 16 + (← hexVal b)) :: (← hexBytes rest)
  | _ => throw "odd hex length"

def parseInt (s : String) : D Int :=
  match s.toInt? with
  | some n => pure n
  | none => throw s!"bad int {s}"

def scalar (j : Json) : D Scalar := do
  let (k, v) ← tag j
  match k with
  | "null" => pure .null
  | "bool" => return .bool (← v.getBool?)
  | "int" => return .int (← parseInt (← v.getStr?))
  | "text" => return .text (cps (← v.getStr?))
  | "id" => return .id (cps (← v.getStr?))
  | "bytes" => return .bytes (← hexBytes (← v.getStr?).toList)
  | _ => throw s!"unknown scalar tag {k}"

partial def value (j : Json) : D Value := do
  let (k, v) ← tag j
  match k with
  | "arr" => return .arr (← (← v.getArr?).toList.mapM value)
  | "row" => do
    let fs ← (← v.getArr?).toList.mapM fun p => do
      let (n, x) ← pair p
      return (← n.getStr?, ← value x)
    return .row fs
  | _ => return .s (← scalar j)

def img (s : String) : D Img :=
  match s with
  | "self" => pure .self | "old" => pure .old | "next" => pure .next
  | _ => throw s!"unknown image {s}"

def term (j : Json) : D Term := do
  if j == Json.str "viewer" then return .viewer
  let (k, v) ← tag j
  match k with
  | "col" => do let (i, c) ← pair v; return .col (← img (← i.getStr?)) (← c.getStr?)
  | "lit" => return .lit (← scalar v)
  | _ => throw s!"unknown term {k}"

partial def rule (j : Json) : D Rule := do
  if j == Json.str "allow" then return .allow
  if j == Json.str "deny" then return .deny
  let (k, v) ← tag j
  match k with
  | "eq" => do let (a, b) ← pair v; return .eq (← term a) (← term b)
  | "ne" => do let (a, b) ← pair v; return .ne (← term a) (← term b)
  | "probe" => do
    let key ← (← arr v "key").toList.mapM fun p => do
      let (c, t) ← pair p
      return (← c.getStr?, ← term t)
    return .probe (← str v "table") key
  | "and" => do let (a, b) ← pair v; return .and (← rule a) (← rule b)
  | "or" => do let (a, b) ← pair v; return .or (← rule a) (← rule b)
  | "not" => return .not (← rule v)
  | _ => throw s!"unknown rule {k}"

def binop (s : String) : D BinOp :=
  match s with
  | "add" => pure .add | "sub" => pure .sub | "mul" => pure .mul | "div" => pure .div
  | "mod" => pure .mod | "eq" => pure .eq | "ne" => pure .ne | "lt" => pure .lt
  | "le" => pure .le | "gt" => pure .gt | "ge" => pure .ge
  | _ => throw s!"unknown operator {s}"

mutual
partial def expr (j : Json) : D Expr := do
  if j == Json.str "viewer" then return .viewer
  let (k, v) ← tag j
  match k with
  | "lit" => return .lit (← value v)
  | "var" => return .var (← v.getStr?)
  | "dot" => return .dot (← v.getStr?)
  | "field" => do let (e, c) ← pair v; return .field (← expr e) (← c.getStr?)
  | "neg" => return .neg (← expr v)
  | "bin" => do let (o, a, b) ← triple v; return .bin (← binop (← o.getStr?)) (← expr a) (← expr b)
  | "and" => do let (a, b) ← pair v; return .and (← expr a) (← expr b)
  | "or" => do let (a, b) ← pair v; return .or (← expr a) (← expr b)
  | "not" => return .not (← expr v)
  | "assert" => do let (e, c) ← pair v; return .assert (← expr e) (← c.getStr?)
  | "coalesce" => do let (a, b) ← pair v; return .coalesce (← expr a) (← expr b)
  | "cond" => do let (c, a, b) ← triple v; return .cond (← expr c) (← expr a) (← expr b)
  | "call" => do
    let (f, xs) ← pair v
    return .call (← f.getStr?) (← (← xs.getArr?).toList.mapM expr)
  | "arr" => return .arr (← (← v.getArr?).toList.mapM expr)
  | "record" => return .record (← named v)
  | "point" => return .point (← str v "table") (← named (← field v "key"))
  | "page" => do
    let order ← (← arr v "order").toList.mapM fun c => c.getStr?
    let take ← (← field v "take").getNat?
    let desc ← (← field v "desc").getBool?
    return .page (← str v "table") (← named (← field v "pins")) (← optExpr v "filter")
      order desc take (← optExpr v "after")
  | "count" => return .count (← str v "table") (← named (← field v "pins")) (← optExpr v "filter")
  | "exists" => return .exists_ (← str v "table") (← named (← field v "pins")) (← optExpr v "filter")
  | _ => throw s!"unknown expression {k}"

partial def named (j : Json) : D (List (String × Expr)) :=
  do (← j.getArr?).toList.mapM fun p => do
    let (n, e) ← pair p
    return (← n.getStr?, ← expr e)

partial def optExpr (j : Json) (k : String) : D (Option Expr) :=
  match optField j k with
  | none => pure none
  | some e => do return some (← expr e)
end

def writeOp (j : Json) : D WriteOp := do
  let (k, v) ← tag j
  match k with
  | "insert" =>
    return .insert (← str v "table") (← named (← field v "fields")) (← (← field v "ifAbsent").getBool?)
  | "upsert" => return .upsert (← str v "table") (← named (← field v "key")) (← named (← field v "patch"))
  | "update" =>
    return .update (← str v "table") (← named (← field v "key")) (← named (← field v "patch"))
      (← optExpr v "cond")
  | "delete" => return .delete (← str v "table") (← named (← field v "key"))
  | _ => throw s!"unknown write {k}"

partial def stmt (j : Json) : D Stmt := do
  let (k, v) ← tag j
  match k with
  | "assign" => do let (x, e) ← pair v; return .assign (← x.getStr?) (← expr e)
  | "require" => do let (e, c) ← pair v; return .require (← expr e) (← c.getStr?)
  | "ite" => do
    let (c, t, e) ← triple v
    return .ite (← expr c) (← (← t.getArr?).toList.mapM stmt) (← (← e.getArr?).toList.mapM stmt)
  | "ret" => return .ret (← expr v)
  | "write" => do
    let b := match optField v "bind" with
      | some (.str x) => some x
      | _ => none
    return .write b (← writeOp (← field v "op"))
  | _ => throw s!"unknown statement {k}"

def table (j : Json) : D TableDecl := do
  let cols ← (← arr j "cols").toList.mapM fun c => do
    let ref := match optField c "ref" with
      | some (.str t) => some t
      | _ => none
    let onDelete ← match optField c "onDelete" with
      | some (.str "restrict") => pure (some OnDelete.restrict)
      | some (.str "cascade") => pure (some OnDelete.cascade)
      | some (.str "setNull") => pure (some OnDelete.setNull)
      | none => pure none
      | some x => throw s!"unknown onDelete {x}"
    return ({ name := ← str c "name", nullable := ← (← field c "nullable").getBool?, ref, onDelete } : ColDecl)
  let uniques ← (← arr j "uniques").toList.mapM fun u => do
    (← u.getArr?).toList.mapM fun c => c.getStr?
  let codes ← (← arr j "uniqueCodes").toList.mapM fun c => match c with
    | .null => pure none
    | x => do return some (← x.getStr?)
  return { name := ← str j "name", cols, uniques, uniqueCodes := codes,
           read := ← rule (← field j "read"), insert := ← rule (← field j "insert"),
           update := ← rule (← field j "update"), delete := ← rule (← field j "delete") }

def helper (j : Json) : D Helper := do
  return { name := ← str j "name", params := ← (← arr j "params").toList.mapM (·.getStr?),
           body := ← expr (← field j "body") }

def program (j : Json) : D Program := do
  let kind ← match ← str j "kind" with
    | "query" => pure Kind.query
    | "mutation" => pure Kind.mutation
    | k => throw s!"unknown program kind {k}"
  let params ← (← arr j "params").toList.mapM fun p => do
    return ({ name := ← str p "name", optional := ← (← field p "optional").getBool? } : Param)
  return { name := ← str j "name", kind, params, body := ← (← arr j "body").toList.mapM stmt }

/-- A stored row; its columns in the table's declared order. -/
def row (td : TableDecl) (j : Json) : D Row := do
  let cols ← field j "cols"
  let cs ← td.cols.mapM fun c => do
    match cols.getObjVal? c.name with
    | .ok x => return (c.name, ← scalar x)
    | .error _ => return (c.name, Scalar.null)
  return { id := cps (← str j "id"), cols := cs }

def case (j : Json) : D (Case × List String) := do
  let v ← (← field j "version").getNat?
  if v != 1 then throw s!"unsupported case version {v}"
  let sch : Schema := { tables := ← (← field j "schema" >>= (arr · "tables")).toList.mapM table }
  let helpers ← match optField j "helpers" with
    | some h => do (← h.getArr?).toList.mapM helper
    | none => pure []
  let storeJ ← field j "store"
  let tables ← sch.tables.mapM fun td => do
    match storeJ.getObjVal? td.name with
    | .ok rs => return (td.name, ← (← rs.getArr?).toList.mapM (row td))
    | .error _ => return (td.name, [])
  let store : Store := fun t => (tables.lookup t).getD []
  let args ← match optField j "args" with
    | some a => do
      let kvs ← a.getObj?
      kvs.toList.mapM fun (k, x) => do return (k, ← value x)
    | none => pure []
  let budget : Option Nat ← match optField j "budget" with
    | some b => do let n ← b.getNat?; pure (some n)
    | none => pure none
  return ({ schema := sch, helpers, store, viewer := cps (← str j "viewer"),
            program := ← program (← field j "program"), args, budget },
          sch.tables.map (·.name))

/-! ## Tagged output -/

def Scalar.toTagged : Scalar → Json
  | .null => Json.mkObj [("null", .null)]
  | .bool b => Json.mkObj [("bool", .bool b)]
  | .int n => Json.mkObj [("int", .str (toString n))]
  | .text s => Json.mkObj [("text", .str (cpsToString s))]
  | .id s => Json.mkObj [("id", .str (cpsToString s))]
  | .bytes bs => Json.mkObj [("bytes", .str (String.ofList (bs.flatMap fun b => [hexDigit (b / 16), hexDigit (b % 16)])))]

partial def Value.toTagged : Value → Json
  | .s x => Scalar.toTagged x
  | .arr xs => Json.mkObj [("arr", .arr (xs.map Value.toTagged).toArray)]
  | .row fs => Json.mkObj [("row", .arr (fs.map fun p => Json.arr #[.str p.1, Value.toTagged p.2]).toArray)]

def storeTagged (tables : List String) (s : Store) : Json :=
  Json.mkObj (tables.map fun t => (t, .arr ((s t).map fun r =>
    Json.mkObj [("id", .str (cpsToString r.id)),
                ("cols", Json.mkObj (r.cols.map fun p => (p.1, Scalar.toTagged p.2)))]).toArray))

def outcomeTagged (tables : List String) : Outcome → Json
  | .answer d c nx => Json.mkObj [("kind", "answer"), ("data", Value.toTagged d),
      ("complete", .bool c), ("next", Value.toTagged nx)]
  | .unavailable => Json.mkObj [("kind", "unavailable")]
  | .committed r s => Json.mkObj [("kind", "committed"), ("result", Value.toTagged r),
      ("store", storeTagged tables s)]
  | .refused code => Json.mkObj [("kind", "refused"), ("code", .str code)]

/-- One line in, one line out. A line that does not decode answers
`{"kind":"error"}`: the harness counts it as an emitter defect. -/
def answer (line : String) : Json :=
  match Json.parse line >>= case with
  | .ok (c, tables) => outcomeTagged tables (run c)
  | .error e => Json.mkObj [("kind", "error"), ("error", .str e)]

end Quarry.CaseJson
