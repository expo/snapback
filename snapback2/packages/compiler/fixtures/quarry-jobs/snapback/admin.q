job fillAvatars:
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }

job scoped(scope: text <=20):
  chunk p in profiles[scope] first 100 by byScope:
    update profiles[p.id] { avatarUrl: 'https://cdn.example.com/default.png' }
  chunk p in profiles first 50 by byId:
    update profiles[p.id] { avatarUrl: 'https://cdn.example.com/default.png' }
