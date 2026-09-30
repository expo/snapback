-- Generated from fixture windows.shortened.json and digest.shortened.json; server time is authoritative.
fn editWindow(): 60000
fn deleteWindow(): 120000
fn messageTtl(setting: text): 180000 if setting = '24h' else 300000 if setting = '7d' else null
fn digestBucket(at: time): bucket(at, 120s)
view digestPosts: count posts where .parent = null and not .removed by .author, bucket(.at, 120s)
  online only
view digestReposts: count reposts by .actor, bucket(.at, 120s)
  online only
view digestFollowers: count follows by .followed, bucket(.at, 120s)
  online only
schedule dailyDigestEvery every 120s: dailyDigest
