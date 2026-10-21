use std::io::Read;
use argon2::{Argon2,PasswordHasher,password_hash::SaltString};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let mut input=String::new();std::io::stdin().read_to_string(&mut input)?;
 let input:serde_json::Value=serde_json::from_str(&input)?;
 let path=std::path::Path::new(input["store"].as_str().ok_or("store needed")?).canonicalize()?;
 let owned=std::path::Path::new(input["owned"].as_str().ok_or("owned root needed")?).canonicalize()?;
 if !owned.file_name().and_then(|s|s.to_str()).is_some_and(|s|s.starts_with("evol-stage-")) || !path.starts_with(&owned){return Err("only an owned replay copy can be aligned".into())}
 let conn=rusqlite::Connection::open(path)?;let mut matched=0;let mut missing=0;
 for users in input["users"].as_object().ok_or("users object needed")?.values(){
  for user in users.as_array().ok_or("user array needed")?{
   let email=user["email"].as_str().ok_or("email needed")?.trim().to_ascii_lowercase();
   let password=user["password"].as_str().ok_or("password needed")?;
   let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM _credentials WHERE email=?1)",[&email],|r|r.get(0))?;
   if !exists{missing+=1;continue}
   let mut entropy=[0u8;16];std::fs::File::open("/dev/urandom")?.read_exact(&mut entropy)?;
   let salt=SaltString::encode_b64(&entropy).map_err(|_|"salt encoding")?;
   let hash=Argon2::default().hash_password(password.as_bytes(),&salt).map_err(|_|"hashing")?.to_string();
   matched+=conn.execute("UPDATE _credentials SET hash=?1 WHERE email=?2",rusqlite::params![hash,email])?;
  }
 }
 println!("{}",serde_json::json!({"matched":matched,"missing":missing}));Ok(())
}
