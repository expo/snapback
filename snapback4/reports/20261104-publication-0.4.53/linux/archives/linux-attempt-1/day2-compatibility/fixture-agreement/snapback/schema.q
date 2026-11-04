use personas alice
query clock(at: time, optional: time ?, times: [time] <=4):
  return at
