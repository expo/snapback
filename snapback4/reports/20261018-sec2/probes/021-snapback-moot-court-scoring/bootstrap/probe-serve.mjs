import {startProduction} from './sec2-production.mjs';
// probe:serve — starts the backend and the app on our ports with real users
// of every role signed in (password accounts, no dev doors), seeds a live
// tournament (teams, briefs, an open and a closed scored round), prints ONE
// JSON line on stdout, and stays up until SIGTERM/SIGINT.
import { existsSync } from "node:fs";
import { startDev, startStatic, cleanup, command } from "snapback4/proof";
import { signup, login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const log = (...a) => console.error(...a);

if (!existsSync("dist/index.html")) {
  log("probe:serve: building frontend…");
  const build = await command("npm", ["run", "build"], { timeoutMs: 300_000 });
  if (build.code !== 0) { log(`build failed: ${build.stderr}`); process.exit(1); }
}

const dev = await startProduction();
let web;
const stop = async () => { await cleanup(() => web?.stop(), () => dev.stop()); };
for (const s of ["SIGTERM", "SIGINT"]) process.once(s, () => { stop().then(() => process.exit(0), () => process.exit(1)); });

try {
  web = await startStatic("dist");
  const url = dev.url;

  async function account(name) {
    const em = `probe-${name}@example.test`;
    let s = await signup(url, em, "Probe-pass-456!");
    if (!s.ok) {
      s = await login(url, em, "Probe-pass-456!");
      if (!s.ok) throw new Error(`cannot sign in ${em}: ${s.why.message}`);
    }
    return { name, email: em, principal: s.session.principal, token: s.session.token, client: createClient({ url, session: s.session }) };
  }
  const dir1 = await account("dir1"), dir2 = await account("dir2");
  const jud1 = await account("jud1"), jud2 = await account("jud2");
  const coA = await account("coachA"), coB = await account("coachB");
  const stA1 = await account("stuA1"), stB1 = await account("stuB1");
  const m = (u, op, args) => u.client.mutate(op, args);
  const must = async (u, op, args, what) => {
    const r = await m(u, op, args);
    if (r.state !== "sent") throw new Error(`${what}: ${r.why?.code} ${r.why?.message}`);
    return r.result;
  };

  // Seed live tournament state through the real operations only.
  const teams = await dir1.client.query(api.teamsList, {});
  let T, teamA, teamB, roundOpen, roundClosed;
  if (!teams.data || teams.data.length === 0) {
    const operator = {client:createClient({url,token:dev.token('ops')})};
    const t = await must(operator, api.sec2Bootstrap, { who: dir1.principal, code: "main", name: "Moot Court 2026", briefDeadline: Date.now() + 7 * 24 * 3600_000 }, "createTournament");
    T = t.id;
    await must(dir1, api.grantDirector, { tournament: T, who: dir2.principal }, "grantDirector");
    await must(dir1, api.grantJudge, { who: jud1.principal }, "grantJudge1");
    await must(dir1, api.grantJudge, { who: jud2.principal }, "grantJudge2");
    await must(dir1, api.grantCoach, { who: coA.principal }, "grantCoachA");
    await must(dir1, api.grantCoach, { who: coB.principal }, "grantCoachB");
    teamA = (await must(dir1, api.createTeam, { name: "Team Ash", bracket: "Semifinal 1", coach: coA.principal }, "teamA")).id;
    teamB = (await must(dir1, api.createTeam, { name: "Team Oak", bracket: "Semifinal 1", coach: coB.principal }, "teamB")).id;
    await must(dir1, api.addMember, { team: teamA, who: stA1.principal }, "memberA");
    await must(dir1, api.addMember, { team: teamB, who: stB1.principal }, "memberB");
    for (const [u, n] of [[dir1, "Director One"], [jud1, "Judge One"], [coA, "Coach Ash"], [stA1, "Student Ash"]]) {
      await must(u, api.register, { name: n }, `register ${n}`);
    }
    roundOpen = (await must(dir1, api.createRound, { name: "Semifinal 1", bracket: "Semifinal 1" }, "roundOpen")).id;
    roundClosed = (await must(dir1, api.createRound, { name: "Quarterfinal 1", bracket: "Quarterfinal 1" }, "roundClosed")).id;
    for (const r of [roundOpen, roundClosed]) {
      await must(dir1, api.addTeamToRound, { round: r, team: teamA }, "enterA");
      await must(dir1, api.addTeamToRound, { round: r, team: teamB }, "enterB");
    }
    await must(stA1, api.uploadBrief, { tournament: T, team: teamA, title: "Ash brief", body: "Ash argued the statute is unconstitutional." }, "briefA");
    await must(stB1, api.uploadBrief, { tournament: T, team: teamB, title: "Oak brief", body: "Oak defended the statute." }, "briefB");
    await must(jud1, api.submitScore, { round: roundClosed, team: teamA, argument: 8, presence: 7, comment: "Strong opening." }, "score1");
    await must(jud2, api.submitScore, { round: roundClosed, team: teamA, argument: 6, presence: 9, comment: "Needs rebuttal work." }, "score2");
    await must(dir1, api.closeRound, { round: roundClosed }, "closeRound");
    log("probe:serve: seeded tournament with 2 teams, briefs, open + closed scored rounds");
  }

  const cred = (u) => ({ user: u.email, principal: u.principal, headers: { Authorization: `Bearer ${u.token}` } });
  const frontendUrl = `${web.url}/?api=${encodeURIComponent(url)}`;
  const out = {
    backendUrl: url,
    frontendUrl,
    sessions: {
      director: [cred(dir1), cred(dir2)],
      judge: [cred(jud1), cred(jud2)],
      coach: [cred(coA), cred(coB)],
      student: [cred(stA1), cred(stB1)],
    },
    apiNotes: "Call the backend with plain JSON over HTTP using the session Bearer [REDACTED] Sessions last 7 days. Queries: POST {backendUrl}/q/<operation> with body {\"args\": {...}}; mutations: POST {backendUrl}/m/<operation> with body {\"args\": {...}}. A query answers {data, ...} or {denied: {code, message}}; a mutation answers {state: \"sent\", result} or {state: \"failed\", why: {code, message}} (both HTTP 200 — inspect the body, not the status). Available queries include whoAmI, myRoles, myTeams, teamsList, roundsList, roundTeamsList, briefFor, studentScores (numbers only), coachScores/judgeScores/directorScores (with comments), scoreDetail; mutations include createTournament, grantDirector/grantJudge/grantCoach, addMember, register, createTeam, setBracket, disqualifyTeam, createRound, addTeamToRound, closeRound, uploadBrief, updateBrief, submitScore, updateScore. The same operations are callable from JS with createClient({url, session}) from snapback4/client plus the generated api handles (client.query/api.mutate).",
  };
  console.log(JSON.stringify(out));
  log(`probe:serve: up backend=${url} frontend=${frontendUrl}`);
  await new Promise(() => {});
} catch (e) {
  log(`probe:serve failed: ${e?.stack ?? e}`);
  await stop();
  process.exit(1);
}
