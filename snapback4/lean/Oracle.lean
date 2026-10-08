import Quarry.CaseJson

/-- The harness oracle (LLP 3000.035 §5.2): reads one JSON case per line
from stdin and writes one tagged outcome per line, flushing after each, until
end of input. One process serves one harness worker for its whole run. -/
def main : IO UInt32 := do
  let stdin ← IO.getStdin
  let stdout ← IO.getStdout
  repeat
    let line ← stdin.getLine
    if line.isEmpty then break
    let line := line.trimAsciiEnd.toString
    if line.isEmpty then continue
    stdout.putStrLn (Quarry.CaseJson.answer line).compress
    stdout.flush
  return 0
