-- Generated from the selected window configuration; server authoritative.
fn editWindow():
  return 60000
fn deleteWindow():
  return 120000
fn disappearingTtl(option: text):
  if option = '24h':
    return 180000
  if option = '7d':
    return 300000
  return 0
