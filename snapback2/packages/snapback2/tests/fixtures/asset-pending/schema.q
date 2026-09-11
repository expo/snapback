table media:
  creator: principal
  photo: image <=268435456
  immutable creator
  public 'quota regression media'
  insert <- .creator = viewer
  update <- .creator = viewer
  delete <- .creator = viewer

table clips:
  creator: principal
  video: video <=268435456
  immutable creator
  public 'quota regression clips'
  insert <- .creator = viewer
  update <- .creator = viewer
  delete <- .creator = viewer
