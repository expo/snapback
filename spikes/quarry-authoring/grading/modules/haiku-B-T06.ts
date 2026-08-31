const employees = table("employees"); // { id, name, title, managerId }

export const chain = query({ employeeId: scalar() }, ({ db, args }) => {
  const employee = db.get(employees, args.employeeId);
  if (!employee) return [];

  return recurse(employee, (current) => {
    if (!current.managerId) return null;
    return db.get(employees, current.managerId);
  }, { depth: 12 });
});
