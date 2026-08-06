type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

function markdownText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function reactionLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1_023).map((entry) => {
    const reaction = record(entry, 'reaction');
    const base = reaction.emoji && typeof reaction.emoji === 'object'
      ? record(reaction.emoji, 'reaction row')
      : reaction;
    const unicode = text(base.value ?? base.unicode ?? '', 'reaction unicode');
    const creator = record(reaction.creator ?? {}, 'reaction creator');
    const login = typeof creator.login === 'string'
      ? creator.login
      : typeof reaction.creatorLogin === 'string' ? reaction.creatorLogin : 'unknown';
    return `- ${unicode} @${login}`;
  });
}

export function renderMachineIssueMarkdown(
  detailRow: unknown,
  comments: readonly unknown[],
): string {
  const envelope = record(detailRow, 'issue detail envelope');
  const value = record(envelope.value, 'issue detail value');
  const issue = record(value.issue, 'issue');
  const project = record(value.project, 'project');
  const creator = record(value.creator, 'creator');
  const assignee = value.assignee === null ? null : record(value.assignee, 'assignee');
  const labels = Array.isArray(value.labels) ? value.labels : [];
  const title = text(issue.title, 'issue title');
  const sourceID = text(issue.id, 'issue id');
  const shortID = issue.shortID;
  if (!Number.isSafeInteger(shortID)) throw new TypeError('issue shortID must be an integer');
  const lines = [
    '---',
    'schema: zerobugs-machine-issue.v1',
    `id: ${yaml(sourceID)}`,
    `shortID: ${shortID}`,
    `project: ${yaml(text(project.lowerCaseName, 'project lowerCaseName'))}`,
    `visibility: ${yaml(text(issue.visibility, 'issue visibility'))}`,
    `open: ${String(Boolean(issue.open))}`,
    `creator: ${yaml(text(creator.login, 'creator login'))}`,
    `assignee: ${assignee ? yaml(text(assignee.login, 'assignee login')) : 'null'}`,
    `created: ${String(issue.created ?? '')}`,
    `modified: ${String(issue.modified ?? '')}`,
    `commentCount: ${comments.length}`,
    '---',
    '',
    `# #${shortID} ${title}`,
    '',
    '## Description',
    '',
    markdownText(text(issue.description ?? '', 'issue description')) || '_No description._',
    '',
    '## Labels',
    '',
    ...(labels.length > 0
      ? labels.slice(0, 1_023).map((entry) => {
        const label = record(entry, 'label');
        return `- ${text(label.name, 'label name')}`;
      })
      : ['_None._']),
    '',
    '## Reactions',
    '',
    ...(reactionLines(value.emoji).length > 0 ? reactionLines(value.emoji) : ['_None._']),
    '',
    '## Comments',
    '',
  ];
  if (comments.length === 0) lines.push('_No comments._', '');
  for (const item of comments.slice(0, 1_000)) {
    const richComment = record(item, 'rich comment');
    const comment = richComment.comment && typeof richComment.comment === 'object'
      ? record(richComment.comment, 'comment')
      : richComment;
    const commentCreator = record(richComment.creator ?? comment.creator, 'comment creator');
    const commentID = text(comment.id, 'comment id');
    lines.push(
      `<a id="comment-${commentID.replace(/[^A-Za-z0-9_-]/gu, '')}"></a>`,
      `### @${text(commentCreator.login, 'comment creator login')} — ${String(comment.created ?? '')}`,
      '',
      markdownText(text(comment.body ?? '', 'comment body')) || '_Empty comment._',
      '',
    );
    const reactions = reactionLines(richComment.emoji ?? comment.emoji);
    if (reactions.length > 0) lines.push('Reactions:', '', ...reactions, '');
  }
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`;
}

export function markdownError(status: 401 | 404, message: string): string {
  return `# ${status}\n\n${message}\n`;
}
