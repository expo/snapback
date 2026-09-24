-- Generated from config JSON by scripts/configure.mjs; times are evaluated on the server.
fn editWindowMs(): 60000
fn deleteWindowMs(): 120000
fn disappearanceMs(option: text <=3): 180000 if option = '24h' else (300000 if option = '7d' else 0)
