-- keep the predecessor schema; this deletes every row holding a removed case.
-- To map instead, replace each delete with: update enumScalar[p.id] { value: <kept case> }
job remove_enumScalar_value():
  chunk p in enumScalar first 100 by byId:
    if p.value = 'a':
      delete enumScalar[p.id]

-- keep the predecessor schema; this deletes every row holding a removed case; null or absent values become the job's argument.
-- To map instead, replace each delete with: update enumOptional[p.id] { value: <kept case> }
job remove_enumOptional_value(value: enum('b')):
  chunk p in enumOptional first 100 by byId:
    if p.value = null:
      update enumOptional[p.id] { value: value }
    if p.value = 'a':
      delete enumOptional[p.id]

-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).
-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.
job remove_enumList_value():
  chunk p0 in enumList['enum-list-bad'] first 1 by byId:
    delete enumList[p0.id]

-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).
-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.
job remove_nestedOptionalList_value(value: [enum('b')] <=4):
  chunk p in nestedOptionalList first 100 by byId:
    if p.value = null:
      update nestedOptionalList[p.id] { value: value }
  chunk p0 in nestedOptionalList['nested-list-bad'] first 1 by byId:
    delete nestedOptionalList[p0.id]

-- keep the predecessor schema; this truncates every textBound.value to 5 characters.
-- To delete only over-long rows, keep any null fill and replace truncation with:
-- if p.value != slice(p.value, 0, 5):
--   delete textBound[p.id]
job shrink_textBound_value():
  chunk p in textBound first 100 by byId:
    update textBound[p.id] { value: slice(p.value, 0, 5) }

-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).
-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.
job shrink_bytesBound_value():
  chunk p0 in bytesBound['bytes-bad'] first 1 by byId:
    delete bytesBound[p0.id]

-- keep jsonRequired.value optional and apply, then fill it:
job fill_jsonRequired_value(value: json <=10):
  chunk p in jsonRequired first 100 by byId:
    update jsonRequired[p.id] { value: p.value ?? value }

-- keep imageRequired.value optional and apply, then fill it:
job fill_imageRequired_value(value: image <=10):
  chunk p in imageRequired first 100 by byId:
    update imageRequired[p.id] { value: p.value ?? value }

-- keep videoRequired.value optional and apply, then fill it:
job fill_videoRequired_value(value: video <=10):
  chunk p in videoRequired first 100 by byId:
    update videoRequired[p.id] { value: p.value ?? value }

-- keep the predecessor schema; this deletes every row holding a removed case; null or absent values become the job's argument.
-- To map instead, replace each delete with: update mixedEnum[p.id] { value: <kept case> }
job remove_mixedEnum_value(value: enum('b')):
  chunk p in mixedEnum first 100 by byId:
    if p.value = null:
      update mixedEnum[p.id] { value: value }
    if p.value = 'a':
      delete mixedEnum[p.id]

-- first add the successor's cases to this declaration and apply (a widening), so this job compiles there.
-- keep that widened declaration; this deletes every row holding a removed case; null or absent values become the job's argument.
-- To map instead, replace each delete with: update disjointEnum[p.id] { value: <kept case> }
job remove_disjointEnum_value(value: enum('c')):
  chunk p in disjointEnum first 100 by byId:
    if p.value = null:
      update disjointEnum[p.id] { value: value }
    if p.value = 'a':
      delete disjointEnum[p.id]
