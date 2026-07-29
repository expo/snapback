--
-- PostgreSQL database dump
--

\restrict e4o1zGpeaemzUtpjcvRwFbBPHNRfTEeYeYxpoLf6u7F0Mhng2FweyKMepOARs3g

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: can_access_issue(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_issue(requested_issue uuid, requested_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.issues
    where id = requested_issue
      and public.is_organization_member(organization_id, requested_user)
  );
$$;


--
-- Name: is_organization_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_organization_member(requested_organization uuid, requested_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = requested_organization
      and user_id = requested_user
  );
$$;


--
-- Name: linear_comment_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.linear_comment_activity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  insert into public.activities (issue_id, actor_id, kind, detail)
  values (new.issue_id, new.author_id, 'comment.created', jsonb_build_object('commentId', new.id));
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_id uuid NOT NULL,
    project_id uuid NOT NULL,
    assignee_id uuid,
    issue_number integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    priority integer NOT NULL,
    board_position numeric(18,6) NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    search_document tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char"))) STORED,
    estimate_points integer DEFAULT 0 NOT NULL,
    CONSTRAINT issues_estimate_points_check CHECK (((estimate_points >= 0) AND (estimate_points <= 100))),
    CONSTRAINT issues_priority_check CHECK (((priority >= 0) AND (priority <= 4))),
    CONSTRAINT issues_revision_check CHECK ((revision > 0)),
    CONSTRAINT issues_status_check CHECK ((status = ANY (ARRAY['backlog'::text, 'todo'::text, 'in_progress'::text, 'review'::text, 'done'::text, 'canceled'::text]))),
    CONSTRAINT issues_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300)))
);


--
-- Name: linear_issue_page(uuid, timestamp with time zone, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.linear_issue_page(requested_organization uuid, before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, before_id uuid DEFAULT NULL::uuid, requested_limit integer DEFAULT 50) RETURNS SETOF public.issues
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select issues.*
  from public.issues
  where organization_id = requested_organization
    and (
      before_created_at is null
      or (created_at, id) < (before_created_at, before_id)
    )
  order by created_at desc, id desc
  limit least(greatest(requested_limit, 1), 50);
$$;


--
-- Name: linear_search_issues(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.linear_search_issues(requested_organization uuid, search_query text, requested_limit integer DEFAULT 50) RETURNS SETOF public.issues
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select issues.*
  from public.issues
  where organization_id = requested_organization
    and search_document @@ websearch_to_tsquery('english', search_query)
  order by
    ts_rank(search_document, websearch_to_tsquery('english', search_query)) desc,
    issue_number asc,
    id asc
  limit least(greatest(requested_limit, 1), 50);
$$;


--
-- Name: linear_touch_issue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.linear_touch_issue() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


--
-- Name: linear_update_issue(uuid, text, integer, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.linear_update_issue(requested_issue uuid, requested_status text, requested_priority integer, requested_assignee uuid, requested_board_position numeric, requested_action text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  before_row public.issues;
  after_row public.issues;
  activity_sequence bigint;
begin
  select * into before_row
  from public.issues
  where id = requested_issue
  for update;

  if before_row.id is null then
    raise exception 'issue unavailable';
  end if;

  if requested_assignee is not null and not exists (
    select 1
    from public.organization_members
    where organization_id = before_row.organization_id
      and user_id = requested_assignee
  ) then
    raise exception 'assignee is not an organization member';
  end if;

  update public.issues
  set status = requested_status,
      priority = requested_priority,
      assignee_id = requested_assignee,
      board_position = requested_board_position,
      revision = revision + 1
  where id = requested_issue
  returning * into after_row;

  insert into public.activities (issue_id, actor_id, kind, detail)
  values (
    requested_issue,
    (select auth.uid()),
    requested_action,
    jsonb_build_object(
      'before', jsonb_build_object(
        'status', before_row.status,
        'priority', before_row.priority,
        'assigneeId', before_row.assignee_id,
        'boardPosition', before_row.board_position,
        'revision', before_row.revision
      ),
      'after', jsonb_build_object(
        'status', after_row.status,
        'priority', after_row.priority,
        'assigneeId', after_row.assignee_id,
        'boardPosition', after_row.board_position,
        'revision', after_row.revision
      )
    )
  )
  returning sequence into activity_sequence;

  return jsonb_build_object(
    'id', after_row.id,
    'status', after_row.status,
    'priority', after_row.priority,
    'assigneeId', after_row.assignee_id,
    'boardPosition', after_row.board_position,
    'revision', after_row.revision,
    'activitySequence', activity_sequence
  );
end;
$$;


--
-- Name: shares_organization(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shares_organization(requested_user uuid, viewer uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.organization_members target
    join public.organization_members current
      on current.organization_id = target.organization_id
    where target.user_id = requested_user
      and current.user_id = viewer
  );
$$;


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id uuid NOT NULL,
    actor_id uuid DEFAULT auth.uid() NOT NULL,
    kind text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    sequence bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: activities_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activities ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activities_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id uuid NOT NULL,
    author_id uuid DEFAULT auth.uid() NOT NULL,
    body text NOT NULL,
    sequence bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT comments_body_check CHECK (((length(body) >= 1) AND (length(body) <= 4000)))
);


--
-- Name: comments_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.comments ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.comments_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: issue_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_labels (
    issue_id uuid NOT NULL,
    label_id uuid NOT NULL
);


--
-- Name: labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labels (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    arm_namespace text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    arm_namespace text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    team_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['lead'::text, 'member'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activities activities_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_sequence_key UNIQUE (sequence);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: comments comments_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_sequence_key UNIQUE (sequence);


--
-- Name: issue_labels issue_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_labels
    ADD CONSTRAINT issue_labels_pkey PRIMARY KEY (issue_id, label_id);


--
-- Name: issues issues_organization_id_issue_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_organization_id_issue_number_key UNIQUE (organization_id, issue_number);


--
-- Name: issues issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);


--
-- Name: labels labels_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: projects projects_organization_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_organization_id_slug_key UNIQUE (organization_id, slug);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: teams teams_organization_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_key_key UNIQUE (organization_id, key);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: activities_issue_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_issue_sequence_idx ON public.activities USING btree (issue_id, sequence);


--
-- Name: comments_issue_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_issue_sequence_idx ON public.comments USING btree (issue_id, sequence);


--
-- Name: issue_labels_label_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_labels_label_issue_idx ON public.issue_labels USING btree (label_id, issue_id);


--
-- Name: issues_organization_assignee_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_organization_assignee_order_idx ON public.issues USING btree (organization_id, assignee_id, created_at DESC, id DESC);


--
-- Name: issues_organization_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_organization_cursor_idx ON public.issues USING btree (organization_id, created_at DESC, id DESC);


--
-- Name: issues_organization_estimate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_organization_estimate_idx ON public.issues USING btree (organization_id, estimate_points, issue_number);


--
-- Name: issues_organization_project_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_organization_project_order_idx ON public.issues USING btree (organization_id, project_id, created_at DESC, id DESC);


--
-- Name: issues_organization_status_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_organization_status_order_idx ON public.issues USING btree (organization_id, status, created_at DESC, id DESC);


--
-- Name: issues_search_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_search_document_idx ON public.issues USING gin (search_document);


--
-- Name: labels_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX labels_organization_idx ON public.labels USING btree (organization_id, id);


--
-- Name: organization_members_user_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_members_user_org_idx ON public.organization_members USING btree (user_id, organization_id);


--
-- Name: projects_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_organization_idx ON public.projects USING btree (organization_id, id);


--
-- Name: team_members_user_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_user_team_idx ON public.team_members USING btree (user_id, team_id);


--
-- Name: teams_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teams_organization_idx ON public.teams USING btree (organization_id, id);


--
-- Name: comments comments_create_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comments_create_activity AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.linear_comment_activity();


--
-- Name: issues issues_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER issues_touch_updated_at BEFORE UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.linear_touch_issue();


--
-- Name: activities activities_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(user_id);


--
-- Name: activities activities_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(user_id);


--
-- Name: comments comments_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE;


--
-- Name: issue_labels issue_labels_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_labels
    ADD CONSTRAINT issue_labels_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE;


--
-- Name: issue_labels issue_labels_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_labels
    ADD CONSTRAINT issue_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;


--
-- Name: issues issues_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: issues issues_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: issues issues_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: issues issues_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: labels labels_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: projects projects_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: teams teams_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activities activities_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_member_insert ON public.activities FOR INSERT TO authenticated WITH CHECK (((actor_id = ( SELECT auth.uid() AS uid)) AND public.can_access_issue(issue_id, ( SELECT auth.uid() AS uid))));


--
-- Name: activities activities_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activities_member_read ON public.activities FOR SELECT TO authenticated USING (public.can_access_issue(issue_id, ( SELECT auth.uid() AS uid)));


--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

--
-- Name: comments comments_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_member_insert ON public.comments FOR INSERT TO authenticated WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND public.can_access_issue(issue_id, ( SELECT auth.uid() AS uid))));


--
-- Name: comments comments_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_member_read ON public.comments FOR SELECT TO authenticated USING (public.can_access_issue(issue_id, ( SELECT auth.uid() AS uid)));


--
-- Name: issue_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_labels issue_labels_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issue_labels_member_read ON public.issue_labels FOR SELECT TO authenticated USING (public.can_access_issue(issue_id, ( SELECT auth.uid() AS uid)));


--
-- Name: issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

--
-- Name: issues issues_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issues_member_read ON public.issues FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- Name: issues issues_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issues_member_update ON public.issues FOR UPDATE TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- Name: labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

--
-- Name: labels labels_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY labels_member_read ON public.labels FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members organization_members_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_members_member_read ON public.organization_members FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_read ON public.organizations FOR SELECT TO authenticated USING (public.is_organization_member(id, ( SELECT auth.uid() AS uid)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_shared_org_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_shared_org_read ON public.profiles FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.shares_organization(user_id, ( SELECT auth.uid() AS uid))));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_member_read ON public.projects FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members team_members_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_member_read ON public.team_members FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.teams
  WHERE ((teams.id = team_members.team_id) AND public.is_organization_member(teams.organization_id, ( SELECT auth.uid() AS uid))))));


--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: teams teams_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teams_member_read ON public.teams FOR SELECT TO authenticated USING (public.is_organization_member(organization_id, ( SELECT auth.uid() AS uid)));


--
-- PostgreSQL database dump complete
--

\unrestrict e4o1zGpeaemzUtpjcvRwFbBPHNRfTEeYeYxpoLf6u7F0Mhng2FweyKMepOARs3g
