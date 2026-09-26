## Before/after component attribution

Same post-bindgen symbol census as the top 40; shallow raw bytes, not gzip estimates. Categories are exclusive; inlining moves source bodies between classes.

| Component | Baseline B | Final B | Reduction B |
|---|---:|---:|---:|
| serde deserialize | 426,287 | 426,283 | 4 |
| serde serialize | 66,158 | 66,158 | 0 |
| serde_json own code | 51,535 | 49,846 | 1,689 |
| std generics over Snapback types | 439,792 | 430,240 | 9,552 |
| B-trees over std-only types | 147,834 | 147,834 | 0 |
| snapback4-core own code | 486,614 | 465,731 | 20,883 |
| snapback4-device own code | 176,039 | 159,591 | 16,448 |
| .rodata | 90,206 | 89,478 | 728 |
| other | 126,250 | 126,240 | 10 |
| Total attributed | 2,010,715 | 1,961,401 | 49,314 |

Largest monomorphization families remain sorting and B-trees over different element types, plus typed serde visitors.
