import sqlite3,json,os
base=os.path.expanduser('~/sb4-np/ct-mac/')
db=sqlite3.connect('file:'+base+'store/replay-instance/.snapback4/store.sqlite?mode=ro',uri=True);db.row_factory=sqlite3.Row
last=dict(db.execute("SELECT seq,at,program,touched FROM _commits WHERE kind='mutation' AND program!='delivered' ORDER BY seq DESC LIMIT 1").fetchone())
periods=[dict(r) for r in db.execute("SELECT at/1000 second,program,min(seq) firstSeq,max(seq) lastSeq,count(*) commits,sum(writes) writes FROM _commits WHERE program='following:delivery' GROUP BY at/1000,program ORDER BY second")]
print(json.dumps({'lastApplicationMutation':last,'deliverySeconds':periods},indent=2))
