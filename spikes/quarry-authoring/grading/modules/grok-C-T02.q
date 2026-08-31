table users:
  name: text <=80

table recipes:
  owner: users
  title: text <=200
  createdAt: time
  by owner, createdAt

query myRecipes():
  recipes[viewer] last 50
