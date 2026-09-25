-- SQL module insights.daily: §3.6-11.
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    emit push { principal: p.principal } once [p.principal, periodEnd]
