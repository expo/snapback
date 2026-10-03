-- Generated from config/windows.shortened.json; evaluated against server now.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTtl(setting: text):
  return 180000 if setting = '24h' else 300000 if setting = '7d' else null
