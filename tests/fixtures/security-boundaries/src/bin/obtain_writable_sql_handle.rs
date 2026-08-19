use snapback_kernel::branches::MaterializedBase;

fn obtain_writable_connection(base: MaterializedBase) {
    // @attack
    let _ = base.conn;
}

fn main() {}
