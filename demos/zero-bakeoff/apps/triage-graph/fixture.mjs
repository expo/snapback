// @ref LLP 0138#the-six-application-contracts — deterministic A1 facts are
// shared without collapsing either provider into a common backend abstraction.
const STATUSES = ['open', 'in_progress', 'blocked', 'closed'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

export function generateTriageFixture({issueCount = 10_000} = {}) {
  const users = [
    {userKey: 'alice', name: 'Alice'},
    {userKey: 'bob', name: 'Bob'},
    {userKey: 'mallory', name: 'Mallory'},
    ...Array.from({length: 100}, (_, index) => ({
      userKey: `user-${String(index).padStart(3, '0')}`,
      name: `User ${String(index).padStart(3, '0')}`,
    })),
  ];
  const organizations = Array.from({length: 5}, (_, index) => ({
    organizationKey: `org-${index}`,
    name: `Organization ${index}`,
  }));
  const teams = Array.from({length: 50}, (_, index) => ({
    teamKey: `team-${String(index).padStart(2, '0')}`,
    organizationKey: `org-${Math.floor(index / 10)}`,
    name: `Team ${String(index).padStart(2, '0')}`,
  }));
  const memberships = teams.flatMap((team, index) => [
    {membershipKey: `${team.teamKey}:bob`, teamKey: team.teamKey, userKey: 'bob'},
    ...(index < 10
      ? [{membershipKey: `${team.teamKey}:alice`, teamKey: team.teamKey, userKey: 'alice'}]
      : []),
  ]);
  const projects = Array.from({length: 250}, (_, index) => ({
    projectKey: `project-${String(index).padStart(3, '0')}`,
    teamKey: `team-${String(Math.floor(index / 5)).padStart(2, '0')}`,
    name: `Project ${String(index).padStart(3, '0')}`,
  }));
  const labels = Array.from({length: 100}, (_, index) => ({
    labelKey: `label-${String(index).padStart(3, '0')}`,
    teamKey: `team-${String(Math.floor(index / 2)).padStart(2, '0')}`,
    name: ['bug', 'customer', 'security', 'performance', 'ux'][index % 5] + `-${index}`,
  }));
  const issues = Array.from({length: issueCount}, (_, index) => {
    const teamIndex = index % 50;
    return {
      issueKey: `issue-${String(index).padStart(5, '0')}`,
      teamKey: `team-${String(teamIndex).padStart(2, '0')}`,
      projectKey: `project-${String(teamIndex * 5 + (index % 5)).padStart(3, '0')}`,
      assigneeKey: index % 7 === 0 ? 'alice' : `user-${String(index % 100).padStart(3, '0')}`,
      title: `Deterministic issue ${String(index).padStart(5, '0')}`,
      status: STATUSES[index % STATUSES.length],
      priority: PRIORITIES[index % PRIORITIES.length],
      pageKey: String(1_000_000 - index).padStart(7, '0'),
      commentCount: index % 4,
      updatedAt: 1_700_000_000_000 + index,
    };
  });
  const issueLabels = issues.flatMap((issue, index) => [0, 1].map((offset) => ({
    issueLabelKey: `${issue.issueKey}:${offset}`,
    issueKey: issue.issueKey,
    labelKey: `label-${String(((index % 50) * 2 + offset) % 100).padStart(3, '0')}`,
  })));
  const comments = issues.flatMap((issue, index) => Array.from(
    {length: issue.commentCount},
    (_, commentIndex) => ({
      commentKey: `${issue.issueKey}:comment-${commentIndex}`,
      issueKey: issue.issueKey,
      authorKey: commentIndex % 2 === 0 ? 'alice' : 'bob',
      body: `Comment ${commentIndex} on ${issue.issueKey}`,
      createdAt: 1_700_100_000_000 + index * 10 + commentIndex,
    }),
  ));
  const activities = issues.filter((_, index) => index % 2 === 0).map((issue, index) => ({
    activityKey: `${issue.issueKey}:activity`,
    issueKey: issue.issueKey,
    kind: 'issue.seeded',
    createdAt: 1_700_200_000_000 + index,
  }));
  return {users, organizations, teams, memberships, projects, labels, issues, issueLabels, comments, activities};
}

export function batches(rows, size = 900) {
  return Array.from({length: Math.ceil(rows.length / size)}, (_, index) =>
    rows.slice(index * size, (index + 1) * size));
}
