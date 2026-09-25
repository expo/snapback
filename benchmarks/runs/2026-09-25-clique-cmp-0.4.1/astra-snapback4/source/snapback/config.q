-- Generated from fixtures/config/windows.shortened.json; server time only.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTTL(value: text):
  return 180000 if value = '24h' else (300000 if value = '7d' else 0)
