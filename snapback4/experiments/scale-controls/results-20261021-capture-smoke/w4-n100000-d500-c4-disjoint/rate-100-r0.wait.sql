SELECT jsonb_build_object('time',extract(epoch from clock_timestamp()),'states',coalesce(jsonb_agg(to_jsonb(s)),'[]')) FROM
(SELECT state,wait_event_type,wait_event,count(*) n FROM pg_stat_activity
WHERE datname=current_database() AND application_name='sb4scale_raw'
GROUP BY state,wait_event_type,wait_event) s;
\watch 0.1
