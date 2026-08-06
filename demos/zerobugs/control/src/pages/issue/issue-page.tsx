import {nanoid} from 'nanoid';
import {useEffect, useMemo, useRef, useState} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {useParams} from 'wouter';
import {navigate, useHistoryState} from 'wouter/use-browser-location';

import circle from '../../assets/icons/circle.svg';
import statusClosed from '../../assets/icons/issue-closed.svg';
import statusOpen from '../../assets/icons/issue-open.svg';
import {parsePermalink} from '../../comment-permalink.ts';
import {AvatarImage} from '../../components/avatar-image.tsx';
import {Button} from '../../components/button.tsx';
import {CanEdit} from '../../components/can-edit.tsx';
import {Combobox} from '../../components/combobox.tsx';
import {Confirm} from '../../components/confirm.tsx';
import {EmojiPanel} from '../../components/emoji-panel.tsx';
import {ImageUploadArea, type TextAreaPatch} from '../../components/image-upload-area.tsx';
import {LabelPicker} from '../../components/label-picker.tsx';
import {Link} from '../../components/link.tsx';
import {Markdown} from '../../components/markdown.tsx';
import {RelativeTime} from '../../components/relative-time.tsx';
import {UserPicker} from '../../components/user-picker.tsx';
import {useZerobugsQuery} from '../../data/queries.ts';
import {useZerobugsMutation} from '../../data/snapback.ts';
import {useCanEdit} from '../../hooks/use-can-edit.ts';
import {useHash} from '../../hooks/use-hash.ts';
import {useIsOffline} from '../../hooks/use-is-offline.ts';
import {useLogin} from '../../hooks/use-login.tsx';
import {useKeypress} from '../../hooks/use-keypress.ts';
import {MAX_ISSUE_DESCRIPTION_LENGTH, MAX_ISSUE_TITLE_LENGTH} from '../../limits.ts';
import {links, useListContext, type ZbugsHistoryState} from '../../routes.tsx';
import {CommentComposer} from './comment-composer.tsx';
import {Comments} from './comments.tsx';
import {getID} from './get-id.tsx';
import {isCtrlEnter} from './is-ctrl-enter.ts';

export function IssuePage({onReady}: {onReady: () => void}) {
  const params = useParams();
  const {idField, idValue} = getID(params);
  const projectName = params.projectName ?? 'zero';
  const result = useZerobugsQuery('issueDetail', {idField, id: idValue});
  const issue = result.value ?? undefined;
  const login = useLogin();
  const isOffline = useIsOffline();
  const history = useHistoryState<ZbugsHistoryState | undefined>();
  const {setListContext} = useListContext();
  const updateIssue = useZerobugsMutation('issue.update');
  const deleteIssue = useZerobugsMutation('issue.delete');
  const addLabel = useZerobugsMutation('issue.addLabel');
  const removeLabel = useZerobugsMutation('issue.removeLabel');
  const createLabel = useZerobugsMutation('label.createAndAddToIssue');
  const updateNotification = useZerobugsMutation('notification.update');
  const setViewed = useZerobugsMutation('viewState.set');
  const issueCursor = issue ? {id: issue.id, created: issue.created, modified: issue.modified} : null;
  const nextResult = useZerobugsQuery('prevNext', {
    listContext: history?.zbugsListContext ?? null,
    issue: issueCursor,
    dir: 'next',
  });
  const previousResult = useZerobugsQuery('prevNext', {
    listContext: history?.zbugsListContext ?? null,
    issue: issueCursor,
    dir: 'prev',
  });
  const next = nextResult.value?.items[0];
  const previous = previousResult.value?.items[0];
  useKeypress('j', () => next && navigate(links.issue({
    projectName, id: next.id, shortID: next.shortID,
  }), {state: history}));
  useKeypress('k', () => previous && navigate(links.issue({
    projectName, id: previous.id, shortID: previous.shortID,
  }), {state: history}));

  useEffect(() => setListContext(history?.zbugsListContext), [history, setListContext]);
  useEffect(() => {
    if (result.status !== 'pending' && result.status !== 'refreshing') onReady();
  }, [onReady, result.status]);
  useEffect(() => {document.title = `Zero Bugs → ${issue?.title ?? 'Issue Page'}`;}, [issue?.title]);
  useEffect(() => {
    if (!issue || !login.loginState || issue.modified <= (issue.viewState?.viewed ?? 0)) return;
    const timer = setTimeout(() => void setViewed({issueID: issue.id, viewed: Date.now()}), 1000);
    return () => clearTimeout(timer);
  }, [issue?.id, issue?.modified, login.loginState?.decoded.sub]);

  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<{title?: string; description?: string}>({});
  const [deleteConfirmationShown, setDeleteConfirmationShown] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const canEdit = useCanEdit(issue?.creatorID);
  const labelSet = useMemo(() => new Set(issue?.labels.map(label => label.id) ?? []), [issue?.labels]);
  const commentPermalinkID = parsePermalink(useHash()) ?? null;

  if (result.status === 'refused' || result.status === 'not-found-authoritative') return <NotFound />;
  if (!issue) return null;
  const rendering = {...issue, ...edits};

  const save = async () => {
    await updateIssue({id: issue.id, ...edits, modified: Date.now()});
    setEditing(false);
    setEdits({});
  };
  const onInsert = (patch: TextAreaPatch) => setEdits(previous => ({
    ...previous,
    description: patch.apply(previous.description ?? issue.description),
  }));
  const remove = async () => {
    await deleteIssue({id: issue.id});
    navigate(links.list({projectName}));
  };

  return (
    <div className="issue-detail-container" data-issue-detail={issue.id} data-visibility={issue.visibility}
      data-completeness={result.status}>
      <div className="issue-detail">
        <div className="issue-topbar">
          <div className="issue-breadcrumb">
            <Link className="breadcrumb-item" href={links.list({projectName})}>Issues</Link>
            <span className="breadcrumb-item">&rarr;</span>
            <span className="breadcrumb-item">Issue {issue.shortID}</span>
          </div>
          <CanEdit ownerID={issue.creatorID}>
            <div className="edit-buttons">
              {!editing ? <>
                <Button className="edit-button" eventName="Edit issue" onAction={() => setEditing(true)}>Edit</Button>
                <Button className="delete-button" eventName="Delete issue" onAction={() => setDeleteConfirmationShown(true)}>Delete</Button>
              </> : <>
                <Button className="save-button" eventName="Save issue edits" onAction={() => void save()}
                  disabled={rendering.title.trim() === ''}>Save</Button>
                <Button className="cancel-button" eventName="Cancel issue edits" onAction={() => {setEditing(false); setEdits({});}}>Cancel</Button>
              </>}
            </div>
          </CanEdit>
        </div>

        {!editing ? <h1 className="issue-detail-title">{rendering.title}</h1> : (
          <div className="edit-title-container">
            <p className="issue-detail-label">Edit title</p>
            <TextareaAutosize disabled={isOffline} value={rendering.title} className="edit-title" autoFocus
              onChange={event => setEdits({...edits, title: event.target.value})}
              onKeyDown={event => isCtrlEnter(event) && void save()} maxLength={MAX_ISSUE_TITLE_LENGTH} />
          </div>
        )}
        {!editing ? <>
          <div className="description-container markdown-container"><Markdown>{rendering.description}</Markdown></div>
          <EmojiPanel issueID={issue.id} emojis={issue.emoji} />
        </> : (
          <div className="edit-description-container">
            <p className="issue-detail-label">Edit description</p>
            <ImageUploadArea textAreaRef={descriptionRef} onInsert={onInsert}>
              <TextareaAutosize disabled={isOffline} className="edit-description" value={rendering.description}
                onChange={event => setEdits({...edits, description: event.target.value})}
                onKeyDown={event => isCtrlEnter(event) && void save()}
                maxLength={MAX_ISSUE_DESCRIPTION_LENGTH} ref={descriptionRef} />
            </ImageUploadArea>
          </div>
        )}

        <div className="issue-sidebar" data-relation-graph="project creator assignee labels emoji comments">
          <div className="sidebar-item"><p className="issue-detail-label">Project</p><span>{issue.project.name}</span></div>
          <div className="sidebar-item">
            <p className="issue-detail-label">Status</p>
            <Combobox editable={false} disabled={!canEdit || isOffline}
              items={[{text: 'Open', value: true, icon: statusOpen}, {text: 'Closed', value: false, icon: statusClosed}]}
              selectedValue={issue.open}
              onChange={open => void updateIssue({id: issue.id, open, modified: Date.now()})} />
          </div>
          <div className="sidebar-item">
            <p className="issue-detail-label">Assignee</p>
            <UserPicker projectName={projectName} disabled={!canEdit || isOffline}
              selected={{login: issue.assignee?.login}} placeholder="Assign to..." unselectedLabel="Nobody" filter="crew"
              onSelect={user => void updateIssue({id: issue.id, assigneeID: user?.id ?? null, modified: Date.now()})} />
          </div>
          {login.loginState?.decoded.role === 'crew' && <div className="sidebar-item">
            <p className="issue-detail-label">Visibility</p>
            <Combobox<'public' | 'internal'> editable={false} disabled={!canEdit || isOffline}
              items={[{text: 'Public', value: 'public', icon: statusOpen}, {text: 'Internal', value: 'internal', icon: statusClosed}]}
              selectedValue={issue.visibility}
              onChange={visibility => void updateIssue({id: issue.id, visibility, modified: Date.now()})} />
          </div>}
          <div className="sidebar-item">
            <p className="issue-detail-label">Notifications</p>
            <Combobox<'subscribe' | 'unsubscribe'> disabled={!login.loginState || isOffline}
              items={[{text: 'Subscribed', value: 'subscribe', icon: statusClosed}, {text: 'Unsubscribed', value: 'unsubscribe', icon: circle}]}
              selectedValue={issue.notificationState?.subscribed ? 'subscribe' : 'unsubscribe'}
              onChange={subscribed => void updateNotification({issueID: issue.id, subscribed, created: Date.now()})} />
          </div>
          <div className="sidebar-item">
            <p className="issue-detail-label">Creator</p>
            <div className="issue-creator"><AvatarImage user={issue.creator} className="issue-creator-avatar" />{issue.creator.login}</div>
          </div>
          <div className="sidebar-item">
            <p className="issue-detail-label">Labels</p>
            <div className="issue-detail-label-container">{issue.labels.map(label => <span className="pill label" key={label.id}>{label.name}</span>)}</div>
            <CanEdit ownerID={issue.creatorID}>
              <LabelPicker projectName={projectName} selected={labelSet}
                onAssociateLabel={labelID => void addLabel({issueID: issue.id, labelID, projectID: issue.projectID})}
                onDisassociateLabel={labelID => void removeLabel({issueID: issue.id, labelID})}
                onCreateNewLabel={labelName => void createLabel({issueID: issue.id, labelID: nanoid(), labelName, projectID: issue.projectID})} />
            </CanEdit>
          </div>
          <div className="sidebar-item"><p className="issue-detail-label">Last updated</p><RelativeTime timestamp={issue.modified} /></div>
        </div>

        <h2 className="issue-detail-label">Comments</h2>
        <Comments issueID={issue.id} permalinkID={commentPermalinkID} />
        {!login.loginState ? <a href="/api/login/github" className="login-to-comment">Login to comment</a> : <CommentComposer issueID={issue.id} />}
      </div>
      <Confirm isOpen={deleteConfirmationShown} title="Delete Issue" text="Really delete?" okButtonLabel="Delete"
        onClose={confirmed => {if (confirmed) void remove(); setDeleteConfirmationShown(false);}} />
    </div>
  );
}

function NotFound() {
  return <div data-issue-not-found><div><b>Error 404</b></div><div>zarro boogs found</div></div>;
}

export function IssueRedirect({onReady}: {onReady: () => void}) {
  const params = useParams();
  const {idField, idValue} = getID(params);
  const result = useZerobugsQuery('issueDetail', {idField, id: idValue});
  useEffect(() => {
    if (result.value) navigate(links.issue({
      projectName: result.value.project.name,
      shortID: result.value.shortID,
      id: result.value.id,
    }) + window.location.search);
  }, [result.value?.id]);
  if (result.status === 'not-found-authoritative' || result.status === 'refused') {
    onReady();
    return <NotFound />;
  }
  return null;
}
