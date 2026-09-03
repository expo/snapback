query unsupportedWhile():
  while true
  return 0

query unsupportedDevice():
  value = 0
  return device

query unsupportedFunction():
  value = 0
  return recurseForever(1)
