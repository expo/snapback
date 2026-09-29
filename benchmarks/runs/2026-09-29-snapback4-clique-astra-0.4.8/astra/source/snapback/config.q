-- Generated from config/windows.shortened.json; values are server milliseconds.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTTL(mode: text <=3):
  if mode = '24h':
    return 180000
  if mode = '7d':
    return 300000
  return 0
