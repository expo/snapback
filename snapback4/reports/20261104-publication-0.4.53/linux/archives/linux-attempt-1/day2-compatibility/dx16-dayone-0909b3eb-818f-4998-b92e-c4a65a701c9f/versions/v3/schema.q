use identity password
table business:
  title: text <=80
  public 'business records'
  online only
query listDayOne():
  return business first 20 by .id
