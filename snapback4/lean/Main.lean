import Quarry
import Quarry.Examples

/-- Runs the hand-written examples (`Quarry/Examples.lean`) and exits
nonzero on any mismatch. `--print` also prints every outcome. -/
def main (args : List String) : IO UInt32 := do
  if args.contains "--print" then
    for ex in Quarry.Examples.all do
      IO.println s!"{ex.name}: {((Quarry.run ex.case).toJson ex.tables).compress}"
  let failures := Quarry.Examples.check
  for (name, want, got) in failures do
    IO.println s!"FAIL {name}\n  want {want}\n  got  {got}"
  IO.println s!"{Quarry.Examples.all.length - failures.length}/{Quarry.Examples.all.length} examples agree"
  return if failures.isEmpty then 0 else 1
