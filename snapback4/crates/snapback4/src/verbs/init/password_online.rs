//! A small password app with online reads, real roles and no fixture personas.
// @ref LLP 3000.037.000#3-password-online-starters — explicit starter shape.
pub(super) fn configure(files:&mut Vec<(&'static str,String)>,shape:&super::starter::Shape,web:bool) {
    files.retain(|(name,_)| !super::starter::FIXTURES.iter().any(|(fixture,_)|name==fixture));
    let platform=if web {super::starter::Platform::Web}else{super::starter::Platform::Expo};
    let (app,client)=super::starter::identity_screens(platform,None,&super::starter::Body::Todos,true);
    let client=if web {super::starter::online_web_client(client)}else{super::starter::expo_client(client,&super::starter::Offline::Tables{synced:vec![],total:2})};
    for (name,text) in files.iter_mut() {
        match *name {
            "snapback/schema.q" => *text=include_str!("starter/password-online/schema.q").into(),
            "src/client.ts" => *text=client.clone(),
            "src/App.tsx" | "App.tsx" => *text=app.replace("Todos","Notes").replace("Task","Note").replace("tasks","notes").replace("Todo","Note").replace("todo","note"),
            "README.md" => *text=format!("# {}\n\nPassword accounts and online reads. No guest identities, personas or fixture rows.\n\nRun `node scripts/install.mjs`, `npx snapback4 check`, then `npm run backend`\nand `{}`. Sign up creates a roleless account. Only the operator may provision roles.\n`npm run frontend:proof` provisions real staging users and proves a UI write.\n`npm run --silent probe:check` owns a fresh staging deployment and checks shutdown.\nFor production: deploy production, build against its backend URL, then run `npm run prod:check`.\n`prod:serve` deliberately stays up; `snapback4 stop production` stops its backend.\nFor development accounts use `devAccounts` from `snapback4/proof` with\n`{{roles:{{member:2}},provision:api.provision}}` on a `startDev` host.\nBrowser sessions persist in localStorage; reads need the server and offline writes queue.\n",shape.title,if web {"npm run dev"}else{"npm run web"}),
            _=>{},
        }
    }
}
