import {useEffect, useState} from 'react';
import {Redirect, Route, Switch} from 'wouter';

import {useSession} from './auth/session.tsx';
import {LoadingSpinner} from './components/loading-spinner.tsx';
import {Nav} from './components/nav.tsx';
import {useSoftNav} from './hooks/use-softnav.ts';
import {ErrorPage} from './pages/error/error-page.tsx';
import {IssuePage, IssueRedirect} from './pages/issue/issue-page.tsx';
import {ListPage} from './pages/list/list-page.tsx';
import {
  links,
  ListContextProvider,
  routes,
  ZERO_PROJECT_NAME,
} from './routes.tsx';

export function Root() {
  const [contentReady, setContentReady] = useState(false);
  const session = useSession();
  useSoftNav();

  useEffect(() => {
    if (session.snapshot.phase === 'transitioning') setContentReady(false);
  }, [session.snapshot.phase]);

  const showContent = contentReady && session.snapshot.phase !== 'transitioning';
  return (
    <ListContextProvider>
      {!showContent && <LoadingSpinner />}
      <div
        className="app-container flex p-8"
        data-session-phase={session.snapshot.phase}
        style={{opacity: showContent ? 1 : 0, pointerEvents: showContent ? undefined : 'none'}}
      >
        <Switch>
          <Route path={routes.home}>
            <Redirect
              to={`${links.list({projectName: ZERO_PROJECT_NAME.toLowerCase()})}${window.location.search}`}
              replace
            />
          </Route>
          <Route path={routes.deprecatedIssue}>
            <IssueRedirect onReady={() => setContentReady(true)} />
          </Route>
          <Route path="/p/:projectName" nest>
            <div className="primary-nav w-48 shrink-0 grow-0"><Nav /></div>
            <div className="primary-content">
              <Route path="/">
                <ListPage onReady={() => setContentReady(true)} />
              </Route>
              <Route path="/issue/:id">
                {(params: {id: string}) => (
                  <IssuePage key={params.id} onReady={() => setContentReady(true)} />
                )}
              </Route>
            </div>
          </Route>
          <Route component={ErrorPage} />
        </Switch>
      </div>
    </ListContextProvider>
  );
}
