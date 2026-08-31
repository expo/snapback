const employees = table("employees"); // { id, name, title, managerId } — managerId is null at the top

export const chain = query(
  { employeeId: id(employees) },
  ({ db, args }) => {
    const employee = db.get(employees, args.employeeId);
    if (employee === null) return [];

    return recurse(
      employee,
      (current) => {
        if (current.managerId === null) return [];
        const manager = db.get(employees, current.managerId);
        return manager === null ? [] : [manager];
      },
      { depth: 12, fanout: 1 },
    );
  },
);
