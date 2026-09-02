query unsupportedWhile():
  while true
  return 0

query unsupportedMerge():
  value = 0
  return merge(1)

query unsupportedDevice():
  value = 0
  return device

query unsupportedFunction():
  value = 0
  return recurseForever(1)
