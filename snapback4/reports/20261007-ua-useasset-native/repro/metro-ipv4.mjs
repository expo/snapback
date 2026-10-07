import net from 'node:net';
const server=net.createServer(socket=>{const peer=net.connect({host:'::1',port:45190});socket.pipe(peer);peer.pipe(socket);socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());});
server.listen(45190,'127.0.0.1',()=>console.log('UA Metro IPv4 forwarding to owned IPv6 listener'));
