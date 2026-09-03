mutation add(amount: money USD, rate: decimal 3):
  combined = amount + amount
  bounded = min(combined, amount)
  doubled = rate + rate
  packed = { amount: bounded, rate: doubled }
  discounted = packed.amount - amount
  repacked = discounted * 2
  rerated = packed.rate + 1.000
  return +prices { price: 2.50, whole: 10, computed: repacked, rate: rerated }

query get(price: prices):
  row = prices[price]! else PRICE_NOT_FOUND
  return { price: row.price, whole: row.whole, computed: row.computed, rate: row.rate, yen: row.yen }

query atMost(left: money USD, right: money USD):
  return left <= right

query hasYen(price: prices):
  row = prices[price]! else PRICE_NOT_FOUND
  return row.yen != null
