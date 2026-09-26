# Programs — E_INTERNAL

E_INTERNAL means the interpreter reached an undefined compiler temporary.
It names the operation and statement site, without exposing the generated
variable name as an input error. Recompile with `snapback4 check`; if it
recurs, report the operation and site as a compiler defect.
