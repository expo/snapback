const employees = table("employees"); // { id, name, title, managerId }

export const chain = query({ employeeId: scalar() }, ({ db, args }) => {
  const employee = db.get(employees, args.employeeId);
  if (!employee) return [];
  
  return recurse(
    employee,
    (emp) => emp.managerId ? db.get(employees, emp.managerId) : null,
    { depth: 12 }
  );
});
