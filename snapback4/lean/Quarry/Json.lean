import Lean.Data.Json
import Quarry.Run

/-!
# Outcomes as JSON

The shape the later harness compares (README, "Case format"). Ids and text
are both JSON strings on the wire; the model keeps them distinct internally.
Bytes render as lowercase hex. `next` is the model's key tuple; the engine's
cursor is opaque, so the harness compares `next` only for presence (OPEN C1).
-/

namespace Quarry
open Lean (Json)

def cpsToString (xs : List Nat) : String := String.ofList (xs.map Char.ofNat)

def hexDigit (n : Nat) : Char := if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

def Scalar.toJson : Scalar → Json
  | .null => .null
  | .bool b => .bool b
  | .int n => .num (Lean.JsonNumber.fromInt n)
  | .text s => .str (cpsToString s)
  | .id s => .str (cpsToString s)
  | .bytes bs => .str (String.ofList (bs.flatMap fun b => [hexDigit (b / 16), hexDigit (b % 16)]))

partial def Value.toJson : Value → Json
  | .s x => x.toJson
  | .arr xs => .arr (xs.map Value.toJson).toArray
  | .row fs => Json.mkObj (fs.map fun p => (p.1, Value.toJson p.2))

def storeJson (tables : List String) (s : Store) : Json :=
  Json.mkObj (tables.map fun t => (t, .arr ((s t).map fun r => r.toValue.toJson).toArray))

def Outcome.toJson (tables : List String) : Outcome → Json
  | .answer d c nx => Json.mkObj [("kind", "answer"), ("data", d.toJson), ("complete", .bool c),
      ("next", nx.toJson)]
  | .unavailable => Json.mkObj [("kind", "unavailable")]
  | .committed r s => Json.mkObj [("kind", "committed"), ("result", r.toJson),
      ("store", storeJson tables s)]
  | .refused code => Json.mkObj [("kind", "refused"), ("code", .str code)]

end Quarry
