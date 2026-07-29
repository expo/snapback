--
-- PostgreSQL database dump
--

\restrict lEYRDGJmjt1hkimuAIkdHP5ILPntV6Ko5o1XFzAmWZ0thUhKG3vyuXKNJBZDf43

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: can_access_channel(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_access_channel(requested_channel uuid, requested_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.channels c
    where c.id = requested_channel
      and (
        c.visibility = 'public'
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = requested_user
        )
      )
  );
$$;


ALTER FUNCTION public.can_access_channel(requested_channel uuid, requested_user uuid) OWNER TO postgres;

--
-- Name: can_access_realtime_topic(text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_access_realtime_topic(requested_topic text, requested_user uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  requested_channel uuid;
begin
  if split_part(requested_topic, ':', 1) <> 'chat' then
    return false;
  end if;
  requested_channel := split_part(requested_topic, ':', 2)::uuid;
  return public.can_access_channel(requested_channel, requested_user);
exception when invalid_text_representation then
  return false;
end;
$$;


ALTER FUNCTION public.can_access_realtime_topic(requested_topic text, requested_user uuid) OWNER TO postgres;

--
-- Name: is_channel_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_channel_member(requested_channel uuid, requested_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.channel_members cm
    where cm.channel_id = requested_channel and cm.user_id = requested_user
  );
$$;


ALTER FUNCTION public.is_channel_member(requested_channel uuid, requested_user uuid) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: channel_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.channel_members (
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT channel_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])))
);


ALTER TABLE public.channel_members OWNER TO postgres;

--
-- Name: channels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.channels (
    id uuid NOT NULL,
    arm_namespace text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    visibility text NOT NULL,
    sort_key integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT channels_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);


ALTER TABLE public.channels OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    author_id uuid DEFAULT auth.uid() NOT NULL,
    body text NOT NULL,
    seq bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT messages_body_check CHECK (((length(body) >= 1) AND (length(body) <= 4000)))
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: messages_seq_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.messages ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: read_markers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.read_markers (
    channel_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    last_read_seq bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT read_markers_last_read_seq_check CHECK ((last_read_seq >= 0))
);


ALTER TABLE public.read_markers OWNER TO postgres;

--
-- Name: channel_members channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channels channels_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_slug_key UNIQUE (slug);


--
-- Name: channels channels_sort_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_sort_key_key UNIQUE (sort_key);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: messages messages_seq_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_seq_key UNIQUE (seq);


--
-- Name: read_markers read_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.read_markers
    ADD CONSTRAINT read_markers_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: channel_members_user_channel_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX channel_members_user_channel_idx ON public.channel_members USING btree (user_id, channel_id);


--
-- Name: messages_channel_seq_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX messages_channel_seq_idx ON public.messages USING btree (channel_id, seq DESC);


--
-- Name: channel_members channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_members channel_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);


--
-- Name: messages messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: read_markers read_markers_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.read_markers
    ADD CONSTRAINT read_markers_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: read_markers read_markers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.read_markers
    ADD CONSTRAINT read_markers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: channel_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.channel_members ENABLE ROW LEVEL SECURITY;

--
-- Name: channels; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

--
-- Name: channels channels_read_authorized; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY channels_read_authorized ON public.channels FOR SELECT TO authenticated USING (public.can_access_channel(id, ( SELECT auth.uid() AS uid)));


--
-- Name: read_markers markers_insert_own_member; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY markers_insert_own_member ON public.read_markers FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.is_channel_member(channel_id, ( SELECT auth.uid() AS uid))));


--
-- Name: read_markers markers_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY markers_read_own ON public.read_markers FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: read_markers markers_update_own_member; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY markers_update_own_member ON public.read_markers FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.is_channel_member(channel_id, ( SELECT auth.uid() AS uid))));


--
-- Name: channel_members members_read_authorized; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY members_read_authorized ON public.channel_members FOR SELECT TO authenticated USING (public.can_access_channel(channel_id, ( SELECT auth.uid() AS uid)));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_insert_member; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY messages_insert_member ON public.messages FOR INSERT TO authenticated WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND public.is_channel_member(channel_id, ( SELECT auth.uid() AS uid))));


--
-- Name: messages messages_read_authorized; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY messages_read_authorized ON public.messages FOR SELECT TO authenticated USING (public.can_access_channel(channel_id, ( SELECT auth.uid() AS uid)));


--
-- Name: read_markers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.read_markers ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION can_access_channel(requested_channel uuid, requested_user uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_access_channel(requested_channel uuid, requested_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_channel(requested_channel uuid, requested_user uuid) TO authenticated;


--
-- Name: FUNCTION can_access_realtime_topic(requested_topic text, requested_user uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.can_access_realtime_topic(requested_topic text, requested_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_realtime_topic(requested_topic text, requested_user uuid) TO authenticated;


--
-- Name: FUNCTION is_channel_member(requested_channel uuid, requested_user uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.is_channel_member(requested_channel uuid, requested_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_channel_member(requested_channel uuid, requested_user uuid) TO authenticated;


--
-- Name: TABLE channel_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.channel_members TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.channel_members TO authenticated;
GRANT ALL ON TABLE public.channel_members TO service_role;


--
-- Name: TABLE channels; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.channels TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.channels TO authenticated;
GRANT ALL ON TABLE public.channels TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.messages TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: SEQUENCE messages_seq_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE ON SEQUENCE public.messages_seq_seq TO anon;
GRANT ALL ON SEQUENCE public.messages_seq_seq TO authenticated;
GRANT ALL ON SEQUENCE public.messages_seq_seq TO service_role;


--
-- Name: TABLE read_markers; Type: ACL; Schema: public; Owner: postgres
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.read_markers TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.read_markers TO authenticated;
GRANT ALL ON TABLE public.read_markers TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict lEYRDGJmjt1hkimuAIkdHP5ILPntV6Ko5o1XFzAmWZ0thUhKG3vyuXKNJBZDf43
