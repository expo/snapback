import {useCallback, useEffect, useMemo, useRef} from 'react';
import {toast} from 'react-toastify';

import {sessionAuthorityIdentity, useSession} from '../../auth/session.tsx';
import {dataAdapter} from '../../data/snapback.ts';
import {useZerobugsQuery} from '../../data/queries.ts';
import type {CommentCursor, RichComment} from '../../data/types.ts';
import {commentWindowSource, windowIdentity} from '../../windowing/controller.ts';
import {windowScrollState} from '../../windowing/history-state.ts';
import {useWindow} from '../../windowing/use-window.ts';
import {useWouterScrollState} from '../../hooks/use-wouter-scroll-state.ts';
import {makePermalink} from '../../comment-permalink.ts';
import {AvatarImage} from '../../components/avatar-image.tsx';
import {navigate} from '../../navigate.ts';
import {useLogin} from '../../hooks/use-login.tsx';
import {Comment} from './comment.tsx';
import {ToastContent} from './toast-content.tsx';

const ESTIMATED_COMMENT_HEIGHT = 200;

/**
 * Natural-height comment cards feed measurements to the Lane 6a controller;
 * the controller remains the sole owner of cursors, intervals, spacers, and
 * permalink hydration.
 */
export function Comments({issueID, permalinkID}: {issueID: string; permalinkID: string | null}) {
  const {snapshot: sessionSnapshot} = useSession();
  const windowAuthority = useMemo(
    () => sessionAuthorityIdentity(sessionSnapshot),
    [sessionSnapshot],
  );
  const windowEnabled = sessionSnapshot.phase === 'anonymous'
    || sessionSnapshot.phase === 'authenticated';
  const identity = useMemo(() => windowIdentity({
    query: 'commentsPage',
    args: {issueID},
    order: {created: 'asc'},
    authority: windowAuthority,
    bounds: null,
  }), [issueID, windowAuthority]);
  const source = useMemo(() => commentWindowSource(dataAdapter, issueID), [issueID]);
  const windowed = useWindow<RichComment, CommentCursor>({
    identity,
    source,
    pageSize: 20,
    estimateSize: () => ESTIMATED_COMMENT_HEIGHT,
    permalinkID,
    enabled: windowEnabled,
  });
  const [history, setHistory] = useWouterScrollState<CommentCursor>(identity);
  const restored = useRef(false);
  const login = useLogin();
  const latest = useZerobugsQuery('commentsPage', {
    issueID, limit: 1, start: null, dir: 'backward', inclusive: true,
  });
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const root = document.documentElement;
      if (window.scrollY < 600) void windowed.loadBackward();
      if (window.scrollY + window.innerHeight >= root.scrollHeight - 800) {
        void windowed.loadForward();
      }
      const first = windowed.snapshot.items[0]?.row;
      setHistory(windowScrollState({
        identity,
        anchor: first ? {id: first.id, created: first.created} : null,
        offset: 0,
        scrollTop: window.scrollY,
      }));
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  }, [identity, setHistory, windowed]);

  useEffect(() => {
    if (!windowed.snapshot.complete || restored.current) return;
    restored.current = true;
    if (permalinkID) {
      document.getElementById(makePermalink({id: permalinkID}))?.scrollIntoView({block: 'center'});
    } else if (history) {
      window.scrollTo({top: history.scrollTop});
    }
  }, [history, permalinkID, windowed.snapshot.complete, windowed.snapshot.items.length]);

  useEffect(() => {
    const newest = latest.value?.items[0];
    if (!newest) return;
    if (lastSeen.current === null) {
      lastSeen.current = newest.id;
      return;
    }
    if (lastSeen.current === newest.id) return;
    lastSeen.current = newest.id;
    void windowed.loadForward();
    if (newest.creatorID === login.loginState?.decoded.sub) return;
    const visible = document.querySelector(`[data-vrow-key="${CSS.escape(newest.id)}"]`);
    if (visible) return;
    toast(
      <ToastContent toastID={newest.id}>
        <AvatarImage className="toast-avatar-icon" user={newest.creator} />
        {newest.creator.login + ' posted a new comment'}
      </ToastContent>,
      {
        toastId: newest.id,
        containerId: 'bottom',
        onClick: () => navigate(`#${makePermalink(newest)}`),
      },
    );
  }, [latest.value?.items[0]?.id, login.loginState?.decoded.sub, windowed]);

  return (
    <div className="comments-container" data-window-phase={windowed.snapshot.phase}>
      <div data-window-spacer="before" style={{height: windowed.snapshot.spaceBefore}} />
      {windowed.snapshot.items.map(item => (
        <MeasuredComment
          key={item.key}
          row={item.row}
          index={item.index}
          measure={height => windowed.measure(item.key, height)}
          issueID={issueID}
        />
      ))}
      <div data-window-spacer="after" style={{height: windowed.snapshot.spaceAfter}} />
    </div>
  );
}

function MeasuredComment(props: Readonly<{
  row: RichComment;
  index: number;
  issueID: string;
  measure(height: number): void;
}>) {
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!element) return;
    props.measure(element.getBoundingClientRect().height);
    observer.current = new ResizeObserver(entries => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize
        ?? entries[0]?.contentRect.height;
      if (height) props.measure(height);
    });
    observer.current.observe(element);
  }, [props.measure]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (
    <div ref={ref} data-vrow-key={props.row.id} data-vrow-index={props.index} style={{paddingBottom: 16}}>
      <Comment id={props.row.id} issueID={props.issueID} comment={props.row} />
    </div>
  );
}
