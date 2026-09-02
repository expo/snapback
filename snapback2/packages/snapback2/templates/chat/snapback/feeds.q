query globalFeed():
  page = posts[] last 50 by byTime where exists profiles[.author] by byPrincipal
  return page {
    post: .,
    author: profiles[.author] by byPrincipal,
  }

query followingFeed():
  page = posts[] last 50 by byTime where (
    (.author = viewer or exists follows[viewer, .author] by byFollowerFollowed)
    and exists profiles[.author] by byPrincipal
  )
  return page {
    post: .,
    author: profiles[.author] by byPrincipal,
  }
