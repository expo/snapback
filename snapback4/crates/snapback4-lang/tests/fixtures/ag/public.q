table posts:
  author: principal
  public
  online only
view postCounts: count posts by .author
  public 'post totals are public'
  online only
query total(author: principal):
  return postCounts[author]
