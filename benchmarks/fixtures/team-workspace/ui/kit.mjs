// Pure React DOM presentation. Inject the application's React instance once;
// every value, loading/error state, disabled flag and callback is an input.
export function createWorkroomUI(React) {
  const h = React.createElement;
  const test = testID => ({ 'data-testid': testID });
  const shown = value => value === null || value === undefined ? '' : String(value);
  function Button({ children, onClick, disabled = false, type = 'button', testID }) {
    return h('button', { type, disabled, onClick, ...test(testID) }, children);
  }
  function Field({ label, value, onChange, type = 'text', options, testID, disabled = false }) {
    const props = { value: value ?? '', disabled, onChange: event => onChange?.(event.target.value), ...test(testID) };
    return h('label', { className: 'wr-field' }, h('span', null, label), options
      ? h('select', props, options.map(o => h('option', { key: o.value, value: o.value }, o.label)))
      : type === 'textarea' ? h('textarea', props) : h('input', { ...props, type }));
  }
  function Notice({ loading = false, error, testID = 'notice' }) {
    return h('div', { 'aria-live': 'polite', ...test(testID) }, loading ? 'Loading…' : error ? shown(error) : '');
  }
  function Panel({ title, children, testID }) {
    return h('section', { className: 'wr-panel', ...test(testID) }, h('h2', null, title), children);
  }
  function Table({ columns, rows, testID, empty = 'No records.' }) {
    return h('div', { className: 'wr-table', ...test(testID) }, rows.length === 0 ? h('p', null, empty)
      : h('table', null,
        h('thead', null, h('tr', null, columns.map(c => h('th', { key: c.key, scope: 'col' }, c.label)))),
        h('tbody', null, rows.map(row => h('tr', { key: row.id, ...test(`${testID}-row-${row.id}`) },
          columns.map(c => h('td', { key: c.key }, c.render ? c.render(row) : shown(row[c.key]))))))));
  }
  function Form({ onSubmit, children, testID }) {
    return h('form', { onSubmit: event => { event.preventDefault(); onSubmit?.(); }, ...test(testID) }, children);
  }
  function Shell({ organizationName, accountName, sections, activeSection, onNavigate, onSignOut, children }) {
    return h('div', { className: 'workroom', ...test('workroom') },
      h('header', null, h('strong', null, 'Workroom'), h('span', null, organizationName),
        h('span', null, accountName), h(Button, { onClick: onSignOut, testID: 'sign-out' }, 'Sign out')),
      h('nav', { 'aria-label': 'Workspace' }, sections.map(s => h('button', { key: s.id,
        'aria-current': s.id === activeSection ? 'page' : undefined, onClick: () => onNavigate(s.id),
        ...test(`nav-${s.id}`) }, s.label))), h('main', null, children));
  }
  function Accounts({ mode, email, password, name, onEmail, onPassword, onName, onSubmit, onMode, busy, error }) {
    return h(Panel, { title: mode === 'sign-up' ? 'Create account' : 'Sign in', testID: 'accounts' },
      h(Form, { onSubmit, testID: 'account-form' },
        h(Field, { label: 'Name', value: name, onChange: onName, testID: 'account-name' }),
        h(Field, { label: 'Email', value: email, onChange: onEmail, type: 'email', testID: 'account-email' }),
        h(Field, { label: 'Password', value: password, onChange: onPassword, type: 'password', testID: 'account-password' }),
        h(Button, { type: 'submit', disabled: busy, testID: 'account-submit' }, mode === 'sign-up' ? 'Create account' : 'Sign in')),
      h(Button, { onClick: onMode, testID: 'account-mode' }, mode === 'sign-up' ? 'Use existing account' : 'Create an account'),
      h(Notice, { loading: busy, error }));
  }
  function Organizations({ organizations, name, onName, onCreate, onOpen, busy, error }) {
    return h(Panel, { title: 'Your organizations', testID: 'organizations' },
      h(Table, { testID: 'organization-list', rows: organizations, columns: [
        { key: 'name', label: 'Organization', render: row => h(Button, { onClick: () => onOpen(row.id), testID: `open-org-${row.id}` }, row.name) },
        { key: 'role', label: 'Your role' }] }),
      h(Form, { onSubmit: onCreate, testID: 'organization-create' },
        h(Field, { label: 'Organization name', value: name, onChange: onName, testID: 'organization-name' }),
        h(Button, { type: 'submit', disabled: busy, testID: 'organization-submit' }, 'Create organization')),
      h(Notice, { loading: busy, error }));
  }
  function Members({ members, roles, invitations, inviteEmail, inviteRole, onEmail, onRole, onInvite, onMemberRole,
    onRemove, onRevoke, canManage, busy, error }) {
    return h(Panel, { title: 'Members and invitations', testID: 'members' },
      h(Table, { testID: 'member-list', rows: members, columns: [{ key: 'name', label: 'Member' },
        { key: 'role', label: 'Role', render: row => h(Field, { label: row.name + ' role', value: row.role,
          options: roles, disabled: !canManage, onChange: value => onMemberRole(row.id, value), testID: `member-role-${row.id}` }) },
        { key: 'remove', label: 'Manage', render: row => h(Button, { disabled: !canManage, onClick: () => onRemove(row.id), testID: `remove-member-${row.id}` }, 'Remove') }] }),
      h(Form, { onSubmit: onInvite, testID: 'invitation-form' },
        h(Field, { label: 'Invite email', value: inviteEmail, onChange: onEmail, type: 'email', testID: 'invite-email' }),
        h(Field, { label: 'Invite role', value: inviteRole, options: roles, onChange: onRole, testID: 'invite-role' }),
        h(Button, { type: 'submit', disabled: !canManage || busy, testID: 'invite-submit' }, 'Send invitation')),
      h(Table, { testID: 'invitation-list', rows: invitations, columns: [{ key: 'email', label: 'Email' }, { key: 'state', label: 'State' },
        { key: 'expiresAt', label: 'Expires' }, { key: 'revoke', label: 'Manage', render: row => h(Button,
          { disabled: !canManage, onClick: () => onRevoke(row.id), testID: `revoke-invitation-${row.id}` }, 'Revoke') }] }),
      h(Notice, { loading: busy, error }));
  }
  function Invitation({ email, organizationName, state, onAccept, canAccept, busy, error }) {
    return h(Panel, { title: 'Invitation', testID: 'invitation' }, h('p', null, `${email} is invited to ${organizationName}.`),
      h('p', test('invitation-state'), state), h(Button, { onClick: onAccept, disabled: !canAccept || busy, testID: 'invitation-accept' }, 'Accept invitation'),
      h(Notice, { loading: busy, error }));
  }
  function Projects({ projects, name, onName, onCreate, onOpen, onArchive, canWrite, busy, error }) {
    return h(Panel, { title: 'Projects', testID: 'projects' },
      h(Table, { testID: 'project-list', rows: projects, columns: [{ key: 'name', label: 'Project', render: row =>
        h(Button, { onClick: () => onOpen(row.id), testID: `open-project-${row.id}` }, row.name) }, { key: 'archived', label: 'Archived' },
      { key: 'archive', label: 'Manage', render: row => h(Button, { onClick: () => onArchive(row.id), disabled: !canWrite, testID: `archive-project-${row.id}` }, 'Archive') }] }),
      h(Form, { onSubmit: onCreate, testID: 'project-create' }, h(Field, { label: 'Project name', value: name, onChange: onName, testID: 'project-name' }),
        h(Button, { type: 'submit', disabled: !canWrite || busy, testID: 'project-submit' }, 'Create project')), h(Notice, { loading: busy, error }));
  }
  function Tasks({ tasks, status, assignee, statusOptions, assigneeOptions, onStatus, onAssignee, onOpen, onNext,
    onPrevious, hasNext, hasPrevious, onCreate, loading, error }) {
    return h(Panel, { title: 'Tasks', testID: 'tasks' },
      h('div', { className: 'wr-controls' }, h(Field, { label: 'Status', value: status, options: statusOptions, onChange: onStatus, testID: 'task-filter-status' }),
        h(Field, { label: 'Assignee', value: assignee, options: assigneeOptions, onChange: onAssignee, testID: 'task-filter-assignee' }),
        h(Button, { onClick: onCreate, testID: 'task-create' }, 'New task')),
      h(Table, { testID: 'task-list', rows: tasks, columns: [{ key: 'title', label: 'Task', render: row =>
        h(Button, { onClick: () => onOpen(row.id), testID: `open-task-${row.id}` }, row.title) },
      { key: 'status', label: 'Status' }, { key: 'assigneeName', label: 'Assignee' }, { key: 'dueDate', label: 'Due' }] }),
      h(Button, { onClick: onPrevious, disabled: !hasPrevious, testID: 'tasks-previous' }, 'Previous'),
      h(Button, { onClick: onNext, disabled: !hasNext, testID: 'tasks-next' }, 'Next'), h(Notice, { loading, error }));
  }
  function TaskDetail({ task, statusOptions, assigneeOptions, onChange, onSave, onArchive, comments, comment,
    onComment, onPost, attachments, onFile, onDownload, onDeleteAttachment, canWrite, canDelete, busy, error }) {
    return h(Panel, { title: task.title || 'New task', testID: 'task-detail' },
      h(Form, { onSubmit: onSave, testID: 'task-form' },
        ...[['Title', 'title', 'text'], ['Description', 'description', 'textarea'], ['Due date', 'dueDate', 'datetime-local']].map(([label, key, type]) =>
          h(Field, { key, label, type, value: task[key], onChange: value => onChange(key, value), testID: `task-${key}` })),
        h(Field, { label: 'Status', value: task.status, options: statusOptions, onChange: value => onChange('status', value), testID: 'task-status' }),
        h(Field, { label: 'Assignee', value: task.assignee, options: assigneeOptions, onChange: value => onChange('assignee', value), testID: 'task-assignee' }),
        h(Button, { type: 'submit', disabled: !canWrite || busy, testID: 'task-save' }, 'Save task')),
      h(Button, { onClick: onArchive, disabled: !canDelete, testID: 'task-archive' }, 'Archive task'),
      h(Table, { testID: 'comment-list', rows: comments, columns: [{ key: 'author', label: 'Author' }, { key: 'body', label: 'Comment' }] }),
      h(Form, { onSubmit: onPost, testID: 'comment-form' }, h(Field, { label: 'Comment', value: comment, onChange: onComment, type: 'textarea', testID: 'comment-body' }),
        h(Button, { type: 'submit', disabled: !canWrite || busy, testID: 'comment-post' }, 'Post comment')),
      h('label', null, 'Attach PDF or image', h('input', { type: 'file', accept: '.pdf,image/png,image/jpeg', disabled: !canWrite,
        onChange: event => onFile?.(event.target.files?.[0] ?? null), ...test('attachment-file') })),
      h(Table, { testID: 'attachment-list', rows: attachments, columns: [{ key: 'name', label: 'File' }, { key: 'bytes', label: 'Bytes' },
        { key: 'extractionState', label: 'Text extraction' }, { key: 'download', label: 'Download', render: row =>
          h(Button, { onClick: () => onDownload(row.id), testID: `download-${row.id}` }, 'Download') }, { key: 'delete', label: 'Delete', render: row =>
          h(Button, { onClick: () => onDeleteAttachment(row.id), disabled: !canDelete, testID: `delete-attachment-${row.id}` }, 'Delete') }] }),
      h(Notice, { loading: busy, error }));
  }
  function Billing({ plan, seatLimit, members, renewalDate, loading, error }) {
    return h(Panel, { title: 'Billing', testID: 'billing' }, h('dl', null,
      ...[['Plan', plan], ['Seats', `${members} / ${seatLimit}`], ['Renewal', renewalDate]].flatMap(([label, value]) =>
        [h('dt', { key: label }, label), h('dd', { key: label + '-value', ...test(`billing-${label.toLowerCase()}`) }, shown(value))])),
      h(Notice, { loading, error }));
  }
  function Audit({ entries, onNext, hasNext, loading, error }) {
    return h(Panel, { title: 'Audit log', testID: 'audit' }, h(Table, { testID: 'audit-list', rows: entries,
      columns: [{ key: 'time', label: 'Time' }, { key: 'actor', label: 'Actor' }, { key: 'event', label: 'Event' }, { key: 'description', label: 'Description' }] }),
      h(Button, { onClick: onNext, disabled: !hasNext, testID: 'audit-next' }, 'Next'), h(Notice, { loading, error }));
  }
  function Report({ rows, onExport, loading, error }) {
    return h(Panel, { title: 'Organization report', testID: 'report' }, h(Table, { testID: 'report-table', rows,
      columns: [{ key: 'name', label: 'Member' }, { key: 'open', label: 'Open tasks' }, { key: 'overdue', label: 'Overdue tasks' }, { key: 'attachmentBytes', label: 'Attachment bytes' }] }),
      h(Button, { onClick: onExport, disabled: loading, testID: 'report-export' }, 'Export CSV'), h(Notice, { loading, error }));
  }
  function Search({ term, onTerm, onSearch, results, onOpen, loading, error }) {
    return h(Panel, { title: 'Search', testID: 'search' }, h(Form, { onSubmit: onSearch, testID: 'search-form' },
      h(Field, { label: 'Search tasks, comments and attachments', value: term, onChange: onTerm, testID: 'search-term' }),
      h(Button, { type: 'submit', disabled: loading, testID: 'search-submit' }, 'Search')),
      h(Table, { testID: 'search-results', rows: results, columns: [{ key: 'title', label: 'Result', render: row =>
        h(Button, { onClick: () => onOpen(row.id), testID: `search-open-${row.id}` }, row.title) }, { key: 'source', label: 'Matched in' }, { key: 'snippet', label: 'Text' }] }),
      h(Notice, { loading, error }));
  }
  return { Button, Field, Notice, Panel, Table, Form, Shell, Accounts, Organizations, Members, Invitation,
    Projects, Tasks, TaskDetail, Billing, Audit, Report, Search };
}
