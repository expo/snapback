import sqlite3,sys,pathlib,shutil
src,stage,state=map(pathlib.Path,sys.argv[1:]); dst=src.parent/str(stage)
(dst/'.snapback4').mkdir(parents=True,exist_ok=True)
shutil.copytree(src/'snapback',dst/'snapback',dirs_exist_ok=True)
with sqlite3.connect(src/'.snapback4/store.sqlite') as a, sqlite3.connect(dst/'.snapback4/store.sqlite') as b: a.backup(b)
shutil.copyfile(state/'state.private.json',dst/'state.private.json')
print('snapshotted',stage)
