import classNames from 'classnames';
import Cookies from 'js-cookie';
import {memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {useDebouncedCallback} from 'use-debounce';
import {useParams, useSearch} from 'wouter';

import InfoIcon from '../../assets/images/icon-info.svg?react';
import {sessionAuthorityIdentity, useSession} from '../../auth/session.tsx';
import {Button} from '../../components/button.tsx';
import {Filter, type Selection} from '../../components/filter.tsx';
import {IssueLink} from '../../components/issue-link.tsx';
import {Link} from '../../components/link.tsx';
import {OnboardingModal} from '../../components/onboarding-modal.tsx';
import {RelativeTime} from '../../components/relative-time.tsx';
import {dataAdapter, useMutationPresentation} from '../../data/snapback.ts';
import {useZerobugsQuery} from '../../data/queries.ts';
import type {IssueCursor, ListContext, ListIssue} from '../../data/types.ts';
import {useHash} from '../../hooks/use-hash.ts';
import {useKeypress} from '../../hooks/use-keypress.ts';
import {useLogin} from '../../hooks/use-login.tsx';
import {useWouterScrollState} from '../../hooks/use-wouter-scroll-state.ts';
import {appendParam, navigate, removeParam, setParam} from '../../navigate.ts';
import {isGigabugs, useListContext} from '../../routes.tsx';
import {issueWindowSource, windowIdentity, type WindowItem} from '../../windowing/controller.ts';
import {windowScrollState} from '../../windowing/history-state.ts';
import {useWindow} from '../../windowing/use-window.ts';

export const ITEM_SIZE = 56;

const Row = memo(function Row(props: Readonly<{
  item: WindowItem<ListIssue>;
  sortField: 'created' | 'modified';
  permalinkID: string | null;
  projectName: string;
  listContext: ListContext;
  isLoggedIn: boolean;
  optimisticStatus?: 'pending' | 'confirmed';
}>) {
  const issue = props.item.row;
  const timestamp = props.sortField === 'modified' ? issue.modified : issue.created;
  const unread = issue.modified > (issue.viewState?.viewed ?? 0) && props.isLoggedIn;
  return (
    <div
      className={classNames('row', unread && 'unread', {
        permalink: issue.id === props.permalinkID || String(issue.shortID) === props.permalinkID,
      })}
      data-vrow-key={props.item.key}
      data-vrow-index={props.item.index}
      data-issue-id={issue.id}
      data-optimistic-status={props.optimisticStatus}
      style={{height: ITEM_SIZE}}
    >
      {unread && <span className="view-state-dot" aria-label="Unread" />}
      <IssueLink
        className={classNames('issue-title', {'issue-closed': !issue.open})}
        issue={{projectName: props.projectName, id: issue.id, shortID: issue.shortID}}
        title={issue.title}
        listContext={props.listContext}
      >
        {issue.title}
      </IssueLink>
      <div className="issue-taglist">
        {issue.labels.map(label => (
          <Link key={label.id} className="pill label" href={`?label=${encodeURIComponent(label.name)}`}>
            {label.name}
          </Link>
        ))}
      </div>
      <div className="issue-timestamp"><RelativeTime timestamp={timestamp} /></div>
    </div>
  );
});

export function ListPage({onReady}: {onReady: () => void}) {
  const {snapshot: sessionSnapshot} = useSession();
  const windowAuthority = useMemo(
    () => sessionAuthorityIdentity(sessionSnapshot),
    [sessionSnapshot],
  );
  const windowEnabled = sessionSnapshot.phase === 'anonymous'
    || sessionSnapshot.phase === 'authenticated';
  const login = useLogin();
  const search = useSearch();
  const qs = useMemo(() => new URLSearchParams(search), [search]);
  const params = useParams();
  const projectName = params.projectName ?? 'zero';
  const projectsResult = useZerobugsQuery('allProjects', {limit: 100, start: null});
  const projects = projectsResult.value?.items ?? [];
  const project = projects.find(value => value.lowerCaseName === projectName.toLowerCase());

  const status = qs.get('status')?.toLowerCase() ?? 'open';
  const creator = qs.get('creator');
  const assignee = qs.get('assignee');
  const labels = useMemo(() => qs.getAll('label'), [search]);
  const textFilterQuery = qs.get('q');
  const [textFilter, setTextFilter] = useState(textFilterQuery);
  useEffect(() => setTextFilter(textFilterQuery), [textFilterQuery]);
  const sortField = qs.get('sort')?.toLowerCase() === 'created' ? 'created' : 'modified';
  const sortDirection = qs.get('sortDir')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const open = status === 'open' ? true : status === 'closed' ? false : null;
  const hash = useHash();
  const permalinkID = hash.startsWith('issue-') ? hash.slice(6) : null;

  const listContext = useMemo<ListContext>(() => ({
    projectName,
    open,
    creator,
    assignee,
    labels: labels.length ? labels : null,
    textFilter,
    sortField,
    sortDirection,
  }), [assignee, creator, labels, open, projectName, sortDirection, sortField, textFilter]);
  const identity = useMemo(() => windowIdentity({
    query: 'issueListV2',
    args: listContext,
    order: {sortField, sortDirection},
    authority: windowAuthority,
    bounds: null,
  }), [listContext, sortDirection, sortField, windowAuthority]);
  const source = useMemo(() => issueWindowSource(dataAdapter, listContext), [identity]);
  const windowed = useWindow<ListIssue, IssueCursor>({
    identity,
    source,
    pageSize: 40,
    estimateSize: () => ITEM_SIZE,
    estimatedTotal: project?.issueCountEstimate ?? null,
    permalinkID,
    enabled: windowEnabled,
  });
  const presentation = useMutationPresentation();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const projectTotalResult = useZerobugsQuery('issueList', {
    listContext: {...listContext, open: null, creator: null, assignee: null, labels: null, textFilter: null},
    limit: 1,
  });
  const listRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useWouterScrollState<IssueCursor>(identity);
  const restored = useRef(false);

  useEffect(() => {
    if (isGigabugs(projectName) && !Cookies.get('onboardingDismissed')) setShowOnboarding(true);
  }, [projectName]);

  useEffect(() => {
    if (windowed.snapshot.phase !== 'pending' && windowed.snapshot.phase !== 'hydrating') onReady();
  }, [onReady, windowed.snapshot.phase]);
  useEffect(() => {
    if (!windowed.snapshot.complete || restored.current || !history || !listRef.current) return;
    restored.current = true;
    listRef.current.scrollTop = history.scrollTop;
  }, [history, windowed.snapshot.complete]);
  const {setListContext} = useListContext();
  useEffect(() => {
    setListContext(listContext);
    document.title = `Zero Bugs → ${titleFor(status, creator, assignee, labels, textFilter)}`;
  }, [listContext, setListContext]);

  const onScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) return;
    if (element.scrollTop < ITEM_SIZE * 3) void windowed.loadBackward();
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - ITEM_SIZE * 5) {
      void windowed.loadForward();
    }
    const first = windowed.snapshot.items[0]?.row;
    setHistory(windowScrollState({
      identity,
      anchor: first ? {id: first.id, created: first.created, modified: first.modified} : null,
      offset: 0,
      scrollTop: element.scrollTop,
    }));
  }, [identity, setHistory, windowed]);

  const onFilter = useCallback((selection: Selection) => {
    if ('creator' in selection) navigate(setParam(qs, 'creator', selection.creator));
    else if ('assignee' in selection) navigate(setParam(qs, 'assignee', selection.assignee));
    else navigate(appendParam(qs, 'label', selection.label));
  }, [qs]);
  const updateSearch = useDebouncedCallback((value: string) => navigate(setParam(qs, 'q', value)), 500);
  const [forceSearchMode, setForceSearchMode] = useState(false);
  const searchMode = forceSearchMode || Boolean(textFilter);
  useKeypress('/', () => project?.supportsSearch && setForceSearchMode(true));

  const title = titleFor(status, creator, assignee, labels, textFilter);
  const total = windowed.snapshot.total.kind === 'unknown' ? null : windowed.snapshot.total.value;
  const optimistic = presentation.facts.issues.filter(issue => (
    issue.projectID === project?.id && !windowed.snapshot.items.some(item => item.row.id === issue.id)
  ));

  return (
    <>
      {presentation.refusal && (
        <div className="mutation-refusal" role="alert" data-refusal-code={presentation.refusal.refusal.code}>
          {presentation.refusal.refusal.message}
        </div>
      )}
      <div className="list-view-header-container">
        <h1 className={classNames('list-view-header', {'search-mode': searchMode})}>
          {searchMode ? (
            <div className="search-input-container">
              <input
                aria-label="Search issues"
                type="text"
                className="search-input"
                value={textFilter ?? ''}
                onChange={event => {setTextFilter(event.target.value); updateSearch(event.target.value);}}
                onKeyUp={(event: KeyboardEvent) => event.key === 'Escape' && setForceSearchMode(false)}
                placeholder="Search…"
                autoFocus
              />
            </div>
          ) : <span className="list-view-title">{title}</span>}
          {total !== null && <span className="issue-count" data-list-total={total}>{total.toLocaleString()}</span>}
          <span hidden data-project-issue-count={projectTotalResult.value?.total ?? ''}>
            {projectTotalResult.value?.total ?? ''}
          </span>
          {isGigabugs(projectName) && <button className="info-button" onClick={() => setShowOnboarding(true)}><InfoIcon /></button>}
        </h1>
        <Button
          className="search-toggle"
          eventName="Toggle Search"
          onAction={() => setForceSearchMode(value => !value)}
          style={{visibility: project?.supportsSearch ? 'visible' : 'hidden'}}
        />
      </div>
      <div className="list-view-filter-container">
        <span className="filter-label">Filtered by:</span>
        <div className="set-filter-container">
          {Array.from(qs.entries()).map(([key, value]) => (
            key === 'label' || key === 'creator' || key === 'assignee'
              ? <button
                  className={classNames('pill', {label: key === 'label', user: key !== 'label'})}
                  onClick={() => navigate(removeParam(qs, key, value))}
                  data-key={key}
                  data-value={value}
                  key={`${key}-${value}`}
                >{key}: {value}</button>
              : null
          ))}
        </div>
        <Filter projectName={projectName} onSelect={onFilter} />
        <div className="sort-control-container">
          <Button enabledOffline className="sort-control" eventName="Toggle sort type"
            onAction={() => navigate(setParam(qs, 'sort', sortField === 'created' ? 'modified' : 'created'))}>
            {sortField === 'modified' ? 'Modified' : 'Created'}
          </Button>
          <Button enabledOffline aria-label="Toggle sort direction"
            className={classNames('sort-direction', sortDirection)} eventName="Toggle sort direction"
            onAction={() => navigate(setParam(qs, 'sortDir', sortDirection === 'asc' ? 'desc' : 'asc'))} />
        </div>
      </div>
      <div className="issue-list">
        <div className="issue-list-scroll" ref={listRef} onScroll={onScroll}
          data-window-phase={windowed.snapshot.phase} data-window-complete={windowed.snapshot.complete}
          style={{height: '100%', overflow: 'auto'}}>
          <div data-window-spacer="before" style={{height: windowed.snapshot.spaceBefore}} />
          {optimistic.map((issue, index) => {
            const attempt = presentation.attempts.find(value => value.args.id === issue.id);
            const row = {...issue, labels: [], viewState: null, completeness: {labels: 'refreshing' as const}};
            return <Row key={issue.id} item={{index: -index - 1, key: issue.id, row, size: ITEM_SIZE}}
              optimisticStatus={attempt?.status} sortField={sortField} permalinkID={permalinkID}
              projectName={projectName} listContext={listContext} isLoggedIn={!!login.loginState} />;
          })}
          {windowed.snapshot.items.map(item => <Row key={item.key} item={item} sortField={sortField}
            permalinkID={permalinkID} projectName={projectName} listContext={listContext}
            isLoggedIn={!!login.loginState} />)}
          <div data-window-spacer="after" style={{height: windowed.snapshot.spaceAfter}} />
        </div>
      </div>
      <OnboardingModal isOpen={showOnboarding} onDismiss={() => {
        Cookies.set('onboardingDismissed', 'true', {expires: 365});
        setShowOnboarding(false);
      }} />
    </>
  );
}

function titleFor(status: string, creator: string | null, assignee: string | null, labels: readonly string[], text: string | null) {
  if (creator || assignee || labels.length || text) return 'Filtered Issues';
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)} Issues`;
}
