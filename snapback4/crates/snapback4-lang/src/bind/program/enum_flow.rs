//! Finite enum facts follow Boolean alternatives and surviving control paths.
use super::*;
use super::control::field_path;
impl Binder<'_> {
    // @ref LLP 3000.036.002#12 — union alternatives; never treat one OR arm as required.
    pub(super) fn narrow_enum(&mut self, condition: &A, truth: bool) -> bool {
        let A::Binary { op, left, right, .. } = condition else { return false };
        if (op == "or" && truth) || (op == "and" && !truth) {
            let before = self.visible_bindings();
            let mut a = self.clone();
            let mut b = self.clone();
            a.narrow(left, truth);
            b.narrow(right, truth);
            for (name, mut original) in before {
                let (Some(a), Some(b)) = (a.binding(&name), b.binding(&name)) else { continue };
                original.ty = a.ty.join(&b.ty).unwrap_or(original.ty);
                original.fields = a.fields.iter().filter_map(|(path, ty)| {
                    Some((path.clone(), ty.join(b.fields.get(path)?).ok()?))
                }).collect();
                self.scopes.last_mut().unwrap().insert(name, original);
            }
            return true;
        }
        if op != "=" && op != "!=" { return false; }
        let (candidate, literal) = match (left.as_ref(), right.as_ref()) {
            (A::Literal { value: Literal::Str(value), .. }, other)
            | (other, A::Literal { value: Literal::Str(value), .. }) => (other, value),
            _ => return false,
        };
        let equal = (op == "=") == truth;
        let refine = |ty: &Ty| -> Option<Ty> {
            let Ty::Enum(variants) = ty.required() else { return None };
            let selected = variants.into_iter().filter(|v| (v == literal) == equal).collect::<Vec<_>>();
            if selected.is_empty() { return None; }
            let result = Ty::Enum(selected);
            Some(if ty.is_optional() && !equal { result.optional() } else { result })
        };
        if let A::Name { name, .. } = candidate && let Some(mut binding) = self.binding(name).cloned() {
            if let Some(ty) = refine(&binding.ty) {
                binding.ty = ty;
                self.scopes.last_mut().unwrap().insert(name.clone(), binding);
            }
        } else if let Some((name, path)) = field_path(candidate, self.focal.as_ref().map(|(name, _)| name.as_str()))
            && !path.is_empty() && let Some(mut binding) = self.binding(&name).cloned()
            && let Ok((_, ty)) = self.expr(candidate, &mut setup::Body::default()) && let Some(ty) = refine(&ty) {
            binding.fields.insert(path, ty);
            self.scopes.last_mut().unwrap().insert(name, binding);
        }
        true
    }
}
