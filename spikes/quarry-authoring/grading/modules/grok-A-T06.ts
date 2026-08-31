const employees = table("employees"); // { id, name, title, managerId } — managerId is null at the top

export const chain = query({ employeeId: id(employees) }, ({ db, args }) => {
  const employee = db.get(employees, args.employeeId);
  db.require(employee !== null, "NOT_FOUND");
  return recurse(
    employee,
    (person) => {
      if (!person.managerId) return [];
      const manager = db.get(employees, person.managerId);
      return manager ? [manager] : [];
    },
    { depth: 12, fanout: 1 },
  );
});
