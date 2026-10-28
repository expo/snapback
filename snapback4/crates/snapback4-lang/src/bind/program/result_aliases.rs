//! Typed alias validation uses the same member/shape rules as ordinary results.
use super::*;
impl Binder<'_> {
    pub(super) fn check_result_aliases(&mut self,row_ty:&Ty,fields:&[ShapeField])->Fallible<()> {
        for field in fields {
            if let ShapeField::Field{name,site,..}=field {
                if self.catalog.documents.iter().flat_map(|d|&d.result_aliases).any(|(_,old,_,s)|s==site&&old==name)
                    && self.row_fields(&row_ty,site)?.iter().any(|(existing,_)|existing==name) {
                    return Err(type_error(site,format!("result alias {name} collides with an existing result field"),"use a distinct old field name; aliases never replace existing values"));
                }
            }
        }
        Ok(())
    }
    pub(super) fn shape_object(&mut self, row_var: &str, row_ty: Ty, fields: &[ShapeField], site: &Site, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        self.shape_object_filtered(row_var, row_ty, fields, site, out, None)
    }

}
