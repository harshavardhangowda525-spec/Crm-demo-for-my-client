-- Safety net for instant sends: actions already dispatch their message inline;
-- anything left queued is now picked up within a minute instead of five.
-- (The job only calls the app when a message is due.)
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'mh-dispatch'), schedule := '* * * * *')
where exists (select 1 from cron.job where jobname = 'mh-dispatch');
