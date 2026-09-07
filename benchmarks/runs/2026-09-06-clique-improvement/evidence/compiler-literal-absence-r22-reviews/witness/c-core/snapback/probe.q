mutation probe():
  original = [2,null]
  for value in original:
    if value != null:
      require value > 1 else LOW
      insert records {length: value, label: 'chosen', payload: {keep: 'row', original}}
  return {original, next: new}
