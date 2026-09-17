//! One encoded backend per bound generation, shared by authenticated requests.
use super::*;
use snapback4_device::device::{Backend, backend_image::encode_image, store_identity::backend_identity};

pub(super) struct Image { generation: u64, identity: String, bytes: Vec<u8> }

pub(super) fn respond_schema(request: Request, shared: &Shared) {
    let bound = lock(&shared.bound);
    let generation = *lock(&shared.generation);
    let mut cached = lock(&shared.schema_image);
    if cached.as_ref().is_none_or(|image| image.generation != generation) {
        let backend = Backend { generation, schema: bound.schema.clone(), programs: bound.programs.iter().map(|p| p.program.clone()).collect() };
        let identity = backend_identity(&backend);
        let bytes = match encode_image(&backend) {
            Ok(bytes) => bytes,
            Err(error) => return respond(request, 500, json!({ "denied": refusal_json(&error.refusal()) })),
        };
        *cached = Some(Image { generation, identity, bytes });
    }
    let image = cached.as_ref().expect("image installed");
    let binary = request.headers().iter().filter(|h| h.field.equiv("Accept")).any(|h|
        h.value.as_str().split(',').any(|part| {
            let mut parts = part.split(';').map(str::trim);
            parts.next() == Some("application/vnd.snapback4.backend") && !parts.any(|p| p.strip_prefix("q=").is_some_and(|q| q.parse::<f32>() == Ok(0.0)))
        }));
    if !binary {
        let native = lock(&shared.native).as_ref().map(|n| json!({ "digest": n.digest, "jobs": n.jobs, "reads": n.reads }));
        return respond(request, 200, json!({ "generation": generation, "identity": image.identity, "schema": bound.schema, "programs": snapback4_lang::emit::backend_programs(&bound), "native": native }));
    }
    let mut response = Response::from_data(image.bytes.clone());
    for (key, value) in [("Content-Type", "application/vnd.snapback4.backend"), ("Cache-Control", "private, no-store"),
        ("X-Snapback4-Backend-Identity", image.identity.as_str()), ("X-Snapback4-Generation", &generation.to_string()),
        ("Access-Control-Expose-Headers", "X-Snapback4-Backend-Identity, X-Snapback4-Generation"), ("Vary", "Accept")] {
        response.add_header(Header::from_bytes(key, value).unwrap());
    }
    for header in cors(&request) { response.add_header(header); }
    drop(cached); drop(bound);
    let _ = request.respond(response);
}
