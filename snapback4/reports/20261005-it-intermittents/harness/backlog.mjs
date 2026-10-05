import {spawn, execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
const child=spawn('python3',['-u','-c',`import socket,sys
s=socket.socket();s.bind(('127.0.0.1',0));s.listen(1)
print(s.getsockname()[1],flush=True)
sys.stdin.readline()
while True:
 c,_=s.accept();c.settimeout(2)
 try:
  c.recv(4096);c.sendall(b'HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok')
 except (OSError,TimeoutError):pass
 c.close()
`],{stdio:['pipe','pipe','pipe']});
const done=once(child,'exit'); const sockets=[];
try{
 const [line]=await once(child.stdout,'data');const port=Number(String(line).trim());
 const own=()=>execFileSync('ss',['-ltn','sport','=',String(port)],{encoding:'utf8'});
 for(let i=0;i<2;i++){const socket=createConnection({host:'127.0.0.1',port});sockets.push(socket);await once(socket,'connect');}
 console.log(JSON.stringify({phase:'queued',port,ownListener:own(),fds:readFileSync('/proc/self/limits','utf8')}));
 const began=performance.now();
 try{const response=await fetch(`http://127.0.0.1:${port}/q/point`);console.log('UNEXPECTED',response.status);process.exitCode=1;}
 catch(error){console.log(JSON.stringify({phase:'timeout',ms:performance.now()-began,message:error.message,cause:error.cause?.code,ownListener:own()}));if(error.cause?.code!=='UND_ERR_CONNECT_TIMEOUT')process.exitCode=1;}
 for(const socket of sockets)socket.destroy();
 child.stdin.write('accept\n');
 const response=await fetch(`http://127.0.0.1:${port}/alive`);console.log(JSON.stringify({phase:'recovered',status:response.status,body:await response.text()}));
}finally{for(const socket of sockets)socket.destroy();child.kill('SIGTERM');await done;}
