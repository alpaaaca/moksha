-- A pipeline's group, for people (@pipeline(group="shop")): the Pipelines
-- page lists pipelines of one group under it. '' for none, and for builds
-- from before groups.
ALTER TABLE build_pipelines ADD COLUMN group_name TEXT NOT NULL DEFAULT '';
