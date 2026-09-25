# E_PARENT_HAS_CHILDREN

E_PARENT_HAS_CHILDREN requires deleting live children and sweeping expired children before retrying `delete parents[id]`; its message does not identify an occupied child table. Read and delete authority are checked before the child probe. Parent ids cannot be reused while physical children remain.
