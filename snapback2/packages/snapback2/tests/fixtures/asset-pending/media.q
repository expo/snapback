mutation keep(photo: image <=268435456):
  row = insert media { creator: viewer, photo }
  return { id: row.id, photo }

mutation replace(rowId: media, photo: image <=268435456):
  row = media[rowId] ! else NOT_FOUND
  update media[row] { photo }
  return { id: row.id, photo }

mutation release(rowId: media):
  row = media[rowId] ! else NOT_FOUND
  delete media[row]
  return null

mutation inspect(photo: image <=268435456):
  return photo

query get(rowId: media):
  return media[rowId]

mutation keepVideo(video: video <=268435456):
  row = insert clips { creator: viewer, video }
  return { id: row.id, video }

mutation releaseVideo(rowId: clips):
  row = clips[rowId] ! else NOT_FOUND
  delete clips[row]
  return null
