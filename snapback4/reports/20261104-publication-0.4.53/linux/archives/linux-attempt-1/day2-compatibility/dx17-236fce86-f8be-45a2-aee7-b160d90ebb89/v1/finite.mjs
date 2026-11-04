import{mkdirSync,existsSync}from'node:fs';if(process.argv[2]==='frontend'){if(existsSync('dist'))throw Error('dist not removed');mkdirSync('dist');}
