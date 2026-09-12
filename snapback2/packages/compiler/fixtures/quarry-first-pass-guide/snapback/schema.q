use identity

-- Quarry comments use two hyphens.
table messages:
  body: text <=500
  caption: text <=80
  digest: text <=64
  author: principal
  at: time
  unique byDigest: digest
  unique byCaption: caption
  public
  insert <- .author = viewer
  delete <- .author = viewer

maintain messageCounts: count messages by author
  read <- allow
