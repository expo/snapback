mutation inspect(photo: image <=5000000, clip: video <=50000000):
  require clip.duration <= 60000 else TOO_LONG
  return { photo, width: photo.width, clip }

mutation acceptAll(avatar: image <=5000000 ?, trailer: video <=50000000 ?, gallery: [image <=12000000] <=4, albums: [image <=12000000] <=4 ?, reels: [video <=50000000] <=2):
  return { avatar, trailer, gallery, albums, reels }

query echo(photo: image <=5000000, clip: video <=50000000):
  return { photo, clip }

query echoNested(albums: [image <=12000000] <=4 ?):
  return { albums }
