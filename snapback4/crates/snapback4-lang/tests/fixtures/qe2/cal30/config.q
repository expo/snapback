-- Generated from config/windows.shortened.json; values are server constants, never mutation arguments.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTtl(setting: text): 180000 if setting = '24h' else 300000 if setting = '7d' else null
