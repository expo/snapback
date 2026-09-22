table things:
  label: text <=50
  public 'Minimal generated-type diagnostic.'
  sync public
query nullableArray():
  out = []
  for t in things first 10 by byId:
    out = out + [things[t.id] { id, label }]
  return out
