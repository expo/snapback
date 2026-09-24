# Seed only this lane's isolated backend; session tokens are never read or logged.
from pathlib import Path
import subprocess, urllib.request, json, time, sqlite3, sys, socket, os
root=Path(__file__).resolve().parents[2]
udid=sys.argv[1]
log=open('/tmp/n-smoke-seed-backend.log','w')
server=subprocess.Popen([str(root/'target/debug/snapback4'),'dev','--port','4448','--no-watch'],cwd=root/'apps/chat',stdout=log,stderr=log,env={**os.environ,'SNAPBACK4_WITNESS_DRIVER':'1'})
app_started=False
try:
    for _ in range(300):
        if server.poll() is not None: raise RuntimeError('backend startup failed')
        try:
            socket.create_connection(('127.0.0.1',4448),timeout=1).close()
            break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('backend not ready')
    subprocess.run(['xcrun','simctl','launch',udid,'dev.snapback4.chat'],check=True)
    app_started=True
    for _ in range(300):
        with sqlite3.connect(root/'apps/chat/.snapback4/store.sqlite') as db:
            found=db.execute("SELECT DISTINCT principal FROM _sessions WHERE kind='guest'").fetchall()
        if len(found)==1: break
        time.sleep(.1)
    else: raise RuntimeError('ordinary app did not sign in with its guest flow')
    viewer=found[0][0]
    rows=[
        {'table':'profiles','row':{'id':'smoke-profile','principal':viewer,'displayName':'Native Smoke','handle':'native_smoke','avatarUrl':None}},
        {'table':'conversations','row':{'id':'smoke-conversation','creatorId':viewer,'title':'Native smoke history'}},
        {'table':'memberships','row':{'id':'smoke-member','conversationId':'smoke-conversation','principal':viewer,'role':'admin','joinedAt':1}},
        *[{'table':'messages','row':{'id':f'smoke-{i}','conversationId':'smoke-conversation','authorId':viewer,'body':f'Held message {i}','at':1700000000000+i,'editedAt':None,'photo':None}} for i in range(3)]
    ]
    request=urllib.request.Request('http://127.0.0.1:4448/seed',data=json.dumps(rows).encode(),headers={'Content-Type':'application/json'},method='POST')
    answer=json.load(urllib.request.urlopen(request,timeout=10))
    assert answer['seeded']==6,answer
    print(json.dumps({'seeded':6,'sessionFlow':'ordinary createApp guest','viewer':viewer}))
finally:
    if app_started: subprocess.run(['xcrun','simctl','terminate',udid,'dev.snapback4.chat'],check=False)
    if server.poll() is None: server.terminate()
    server.wait(timeout=15)
    log.close()
