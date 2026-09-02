const employees = table("employees"); // { id, name, title, managerId } — managerId is null at the top

export const chain = query({ employeeId: id(employees) }, ({ db, args }) => {
  const employee = db.get(employees, args.employeeId);
  if (employee === null) {
    return [];
  }
  return recurse(
    employee,
    (emp) => {
      const manager =
        emp.managerId === null ? null : db.get(employees, emp.managerId);
      return manager === null ? [] : [manager];
    },
    { depth: 12, fanout: 1 },
  );
});
