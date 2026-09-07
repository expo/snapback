job fillCategories:
  chunk room in rooms first 100 by byId:
    update rooms[room.id] { category: room.category ?? 'general' }
