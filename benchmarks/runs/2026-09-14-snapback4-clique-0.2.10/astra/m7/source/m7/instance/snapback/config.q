-- Generated from config/windows.shortened.json; server evaluates now. Never accepts client window durations.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTTL(setting: text <=10):
  return 180000 if setting = '24h' else (300000 if setting = '7d' else null)
fn digestPeriodMs(): 120000
fn digestPeriod(at: time):
  (period, remainder) = divmod(at - 0, 120000)
  return period * 120000 + 0
