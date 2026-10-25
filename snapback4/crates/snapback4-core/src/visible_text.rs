//! Visible text minimums and boundary trimming share one pinned definition.
// @ref LLP 3000.036.004.000#12-wave-28-inference-and-visible-evidence — format-only consent cannot satisfy a positive minimum.
// Unicode 17.0.0: White_Space union General_Category=Cf union Default_Ignorable_Code_Point.
// Sources: https://www.unicode.org/Public/17.0.0/ucd/{UnicodeData,DerivedCoreProperties,PropList}.txt
// Unicode data copyright and permission: see UNICODE-LICENSE.txt at crate root.
const INVISIBLE:&[(u32,u32)]=&[
    (0x9,0xD),
    (0x20,0x20),
    (0x85,0x85),
    (0xA0,0xA0),
    (0xAD,0xAD),
    (0x34F,0x34F),
    (0x600,0x605),
    (0x61C,0x61C),
    (0x6DD,0x6DD),
    (0x70F,0x70F),
    (0x890,0x891),
    (0x8E2,0x8E2),
    (0x115F,0x1160),
    (0x1680,0x1680),
    (0x17B4,0x17B5),
    (0x180B,0x180F),
    (0x2000,0x200F),
    (0x2028,0x202F),
    (0x205F,0x206F),
    (0x3000,0x3000),
    (0x3164,0x3164),
    (0xFE00,0xFE0F),
    (0xFEFF,0xFEFF),
    (0xFFA0,0xFFA0),
    (0xFFF0,0xFFFB),
    (0x110BD,0x110BD),
    (0x110CD,0x110CD),
    (0x13430,0x1343F),
    (0x1BCA0,0x1BCA3),
    (0x1D173,0x1D17A),
    (0xE0000,0xE0FFF),
];
pub fn visible(c:char)->bool{
    let n=c as u32;
    if n<0xAD{!matches!(n,0x9..=0xD|0x20|0x85|0xA0)}else{!INVISIBLE.iter().any(|&(a,b)|(a..=b).contains(&n))}
}
/// This counts Unicode scalar values, not grapheme clusters or rendered glyphs.
pub fn visible_length(text:&str)->usize{text.chars().filter(|&c|visible(c)).count()}
/// Invisible-only text is blank. Nonblank text retains ordinary whitespace
/// trimming and all presentation controls, including attached emoji sequences.
pub fn trim(text:&str)->&str{
    let text=text.trim();if text.chars().any(visible){text}else{""}
}

#[cfg(test)]mod tests{use super::*;
#[test]fn invisible_scalars_never_satisfy_minimums(){for &(a,b) in INVISIBLE{for n in a..=b{if let Some(c)=char::from_u32(n){assert!(!visible(c),"U+{n:04X}");}}}for value in [" ","\t\n","\u{200b}","\u{200c}","\u{feff}","\u{ad}","\u{2066}\u{2069}","\u{fe0f}","\u{e0067}\u{e007f}"]{assert_eq!(visible_length(value),0);assert_eq!(trim(value),"");}}
#[test]fn visible_text_and_emoji_keep_their_bytes(){for value in ["Yes","同意","مرحبا","❤️","👩‍🔬","🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"]{assert!(visible_length(value)>0);assert_eq!(trim(value),value);let padded=format!(" \u{200b}{value} \u{200b}");assert_eq!(trim(&padded),format!("\u{200b}{value} \u{200b}"));}assert_eq!(visible_length("a\u{200b}b"),2);}
}
