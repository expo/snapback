use snapback_kernel::branches::MaterializedBase;

fn obtain_writable_connection(base: MaterializedBase) {
    let _ = base.conn;
}

fn main() {}
