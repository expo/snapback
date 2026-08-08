import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  skip,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQuery,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';
type Draft = Readonly<{
  title: string; summary: string; status: string; teamSlug: string; budget: string;
}>;
const EMPTY: Draft = { title: '', summary: '', status: 'planned', teamSlug: 'studio', budget: '0' };

export function App() {
  const connection = useSnapbackConnection();
  const directory = useSnapbackQuery(api.projectDirectory, {});
  const teamsState = useSnapbackQuery(api.listTeams, {});
  const rows = directory.status === 'ready' || directory.status === 'refreshing' ? directory.data : [];
  const teams = teamsState.status === 'ready' || teamsState.status === 'refreshing' ? teamsState.data : [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const detail = useSnapbackQuery(api.projectDetail, selectedKey ? { projectKey: selectedKey } : skip);
  const selected = detail.status === 'ready' || detail.status === 'refreshing' ? detail.data[0] : undefined;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (selected) {
      setDraft({
        title: selected.title, summary: selected.summary, status: selected.status,
        teamSlug: selected.teamSlug, budget: String(selected.budget),
      });
      setCreating(false);
    }
  }, [selected]);

  const selectedCard = useMemo(
    () => rows.find((row) => row.projectKey === selectedKey),
    [rows, selectedKey],
  );
  const createProject = useSnapbackMutation(api.createProject);
  const updateProject = useSnapbackMutation(api.updateProject, {
    optimistic: {
      query: api.projectDirectory,
      args: {},
      update: (current, args) => current.map((row) => row.projectKey === args.projectKey
        ? {
          ...row,
          title: args.title,
          summary: args.summary,
          status: args.status,
          teamSlug: args.teamSlug,
          budget: args.budget,
          teamName: teams.find((team) => team.slug === args.teamSlug)?.name ?? null,
          teamColor: teams.find((team) => team.slug === args.teamSlug)?.color ?? null,
        }
        : row),
      isAuthoritative: (current, result) => current.some((row) =>
        row.projectKey === result.projectKey
          && row.title === result.title
          && row.updatedAt === result.updatedAt),
    },
  });
  const deleteProject = useSnapbackMutation(api.deleteProject);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = { ...draft, budget: Number.parseInt(draft.budget, 10) || 0 };
    setNotice('Saving…');
    if (creating) {
      const projectKey = await createProject(fields);
      setSelectedKey(projectKey);
      setCreating(false);
    } else if (selectedKey) {
      await updateProject({ projectKey: selectedKey, ...fields });
    }
    setNotice('Saved');
  };

  const remove = async () => {
    if (!selectedKey) return;
    await deleteProject({ projectKey: selectedKey });
    setSelectedKey(null);
    setDraft(EMPTY);
    setNotice('Deleted');
  };

  const beginCreate = () => {
    setSelectedKey(null);
    setDraft({ ...EMPTY, teamSlug: teams[0]?.slug ?? EMPTY.teamSlug });
    setCreating(true);
    setNotice('');
  };

  return (
    <main className="shell">
      <header><div><p className="eyebrow">PORTFOLIO / LIVE</p><h1>Project dashboard</h1></div><span className="connection">{connection.status}</span></header>
      <section className="layout">
        <aside>
          <div className="aside-title"><h2>Projects</h2><button onClick={beginCreate}>New</button></div>
          {directory.status === 'pending' ? <p>Loading live directory…</p> : null}
          {rows.map((row) => (
            <button className={`project ${row.projectKey === selectedKey ? 'selected' : ''}`} key={row.projectKey} onClick={() => setSelectedKey(row.projectKey)}>
              <span className="team-dot" style={{ background: row.teamColor ?? '#777' }} />
              <span><strong>{row.title}</strong><small>{row.teamName ?? row.teamSlug} · {row.status}</small></span>
              <b>${Math.round(row.budget / 1000)}k</b>
            </button>
          ))}
        </aside>
        <section className="editor">
          {creating || selected ? (
            <form onSubmit={(event) => void submit(event)}>
              <div className="form-heading"><div><p className="eyebrow">{creating ? 'CREATE' : 'DETAIL / EDIT'}</p><h2>{creating ? 'New project' : selectedCard?.title ?? selected?.title}</h2></div>{!creating ? <button className="danger" type="button" onClick={() => void remove()}>Delete</button> : null}</div>
              <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Summary<textarea required rows={4} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
              <div className="pair">
                <label>Team<select value={draft.teamSlug} onChange={(event) => setDraft({ ...draft, teamSlug: event.target.value })}>{teams.map((team) => <option key={team._id} value={team.slug}>{team.name}</option>)}</select></label>
                <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{['planned', 'active', 'paused', 'done'].map((status) => <option key={status}>{status}</option>)}</select></label>
              </div>
              <label>Budget<input min="0" type="number" value={draft.budget} onChange={(event) => setDraft({ ...draft, budget: event.target.value })} /></label>
              <div className="actions"><button className="primary" type="submit">Save project</button><output>{notice}</output></div>
            </form>
          ) : <div className="empty"><p className="eyebrow">RELATIONAL DIRECTORY</p><h2>Select a project</h2><p>The list combines projects with their teams; the detail panel is an independent live query.</p></div>}
        </section>
      </section>
    </main>
  );
}
