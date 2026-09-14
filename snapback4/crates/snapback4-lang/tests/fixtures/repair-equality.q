fn selected(f: text <=10):
  if f == 'x':
    return true
  return false
query selection(f: text <=10):
  return selected(f)
