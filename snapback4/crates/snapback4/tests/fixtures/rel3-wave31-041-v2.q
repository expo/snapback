table trunks:
  label: text 1..40
  stage: enum('intake', 'teardown', 'wood_repair', 'outer_covering', 'relining', 'ready') default 'intake'
  read <- true
  insert <- true
  update <- true
  delete <- deny

mutation logTrunk(label: text 1..40):
  return insert trunks { label }

mutation setStage(trunk: trunks, stage: enum('teardown', 'wood_repair', 'outer_covering', 'relining', 'ready')):
  t = trunks[trunk] ! else NOT_FOUND
  update trunks[trunk] { stage }
  return null

query all():
  return trunks last 50 by .id

alias trunks.stage 'recovering' = 'outer_covering'
