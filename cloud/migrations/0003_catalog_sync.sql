-- Additive, derived catalog and sync metadata. Original lessons and learning rows are untouched.
CREATE TABLE IF NOT EXISTS catalog_versions (
 household_id TEXT PRIMARY KEY, epoch TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))), revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lesson_catalog (
 household_id TEXT NOT NULL, id TEXT NOT NULL, index_json TEXT NOT NULL, public_json TEXT NOT NULL, objective_kind TEXT,
 PRIMARY KEY(household_id,id)
);
CREATE TABLE IF NOT EXISTS explanation_versions (
 household_id TEXT NOT NULL, profile_id TEXT NOT NULL, epoch TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))), revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(household_id,profile_id)
);
CREATE TRIGGER IF NOT EXISTS lessons_catalog_insert AFTER INSERT ON lessons BEGIN
 INSERT INTO lesson_catalog(household_id,id,index_json,public_json,objective_kind) SELECT NEW.household_id,NEW.id,json_object('id',json_extract(NEW.lesson_json,'$.id'),'title',json_extract(NEW.lesson_json,'$.title'),'skill',json_extract(NEW.lesson_json,'$.skill'),'difficulty',json_extract(NEW.lesson_json,'$.difficulty'),'concept',json_extract(NEW.lesson_json,'$.concept'),'size',json_extract(NEW.lesson_json,'$.size'),'family_id',json_extract(NEW.lesson_json,'$.family_id'),'variant',json_extract(NEW.lesson_json,'$.variant'),'legacy',json(CASE json_type(NEW.lesson_json,'$.legacy') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'sequence',json(CASE json_type(NEW.lesson_json,'$.sequence') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'source',json_object('kind',json_extract(NEW.lesson_json,'$.source.kind'),'title',json_extract(NEW.lesson_json,'$.source.title'),'problem',json_extract(NEW.lesson_json,'$.source.problem'))),(SELECT json_group_object(key,json(CASE type WHEN 'text' THEN json_quote(value) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE value END)) FROM json_each(NEW.lesson_json) WHERE key IN ('id','title','prompt','hint','skill','difficulty','size','sequence','family_id','variant','source','concept','choices')),json_extract(NEW.lesson_json,'$.objective.kind') ON CONFLICT(household_id,id) DO UPDATE SET index_json=excluded.index_json,public_json=excluded.public_json,objective_kind=excluded.objective_kind;
 INSERT INTO catalog_versions(household_id,revision) VALUES(NEW.household_id,1) ON CONFLICT(household_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS lessons_catalog_update AFTER UPDATE ON lessons BEGIN
 DELETE FROM lesson_catalog WHERE household_id=OLD.household_id AND id=OLD.id;
 INSERT INTO lesson_catalog(household_id,id,index_json,public_json,objective_kind) SELECT NEW.household_id,NEW.id,json_object('id',json_extract(NEW.lesson_json,'$.id'),'title',json_extract(NEW.lesson_json,'$.title'),'skill',json_extract(NEW.lesson_json,'$.skill'),'difficulty',json_extract(NEW.lesson_json,'$.difficulty'),'concept',json_extract(NEW.lesson_json,'$.concept'),'size',json_extract(NEW.lesson_json,'$.size'),'family_id',json_extract(NEW.lesson_json,'$.family_id'),'variant',json_extract(NEW.lesson_json,'$.variant'),'legacy',json(CASE json_type(NEW.lesson_json,'$.legacy') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'sequence',json(CASE json_type(NEW.lesson_json,'$.sequence') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'source',json_object('kind',json_extract(NEW.lesson_json,'$.source.kind'),'title',json_extract(NEW.lesson_json,'$.source.title'),'problem',json_extract(NEW.lesson_json,'$.source.problem'))),(SELECT json_group_object(key,json(CASE type WHEN 'text' THEN json_quote(value) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE value END)) FROM json_each(NEW.lesson_json) WHERE key IN ('id','title','prompt','hint','skill','difficulty','size','sequence','family_id','variant','source','concept','choices')),json_extract(NEW.lesson_json,'$.objective.kind') ON CONFLICT(household_id,id) DO UPDATE SET index_json=excluded.index_json,public_json=excluded.public_json,objective_kind=excluded.objective_kind;
 INSERT INTO catalog_versions(household_id,revision) VALUES(NEW.household_id,1) ON CONFLICT(household_id) DO UPDATE SET revision=revision+1;
 INSERT INTO catalog_versions(household_id,revision) SELECT OLD.household_id,1 WHERE OLD.household_id<>NEW.household_id ON CONFLICT(household_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS lessons_catalog_delete AFTER DELETE ON lessons BEGIN
 DELETE FROM lesson_catalog WHERE household_id=OLD.household_id AND id=OLD.id;
 INSERT INTO catalog_versions(household_id,revision) VALUES(OLD.household_id,1) ON CONFLICT(household_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS llm_explanations_sync_insert AFTER INSERT ON llm_explanations BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(NEW.household_id,NEW.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS llm_explanations_sync_update AFTER UPDATE ON llm_explanations BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(NEW.household_id,NEW.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
 INSERT INTO explanation_versions(household_id,profile_id,revision) SELECT OLD.household_id,OLD.profile_id,1 WHERE OLD.household_id<>NEW.household_id OR OLD.profile_id<>NEW.profile_id ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS llm_explanations_sync_delete AFTER DELETE ON llm_explanations BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(OLD.household_id,OLD.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS helped_lessons_sync_insert AFTER INSERT ON helped_lessons BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(NEW.household_id,NEW.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS helped_lessons_sync_update AFTER UPDATE ON helped_lessons BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(NEW.household_id,NEW.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
 INSERT INTO explanation_versions(household_id,profile_id,revision) SELECT OLD.household_id,OLD.profile_id,1 WHERE OLD.household_id<>NEW.household_id OR OLD.profile_id<>NEW.profile_id ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS helped_lessons_sync_delete AFTER DELETE ON helped_lessons BEGIN
 INSERT INTO explanation_versions(household_id,profile_id,revision) VALUES(OLD.household_id,OLD.profile_id,1) ON CONFLICT(household_id,profile_id) DO UPDATE SET revision=revision+1;
END;
INSERT OR IGNORE INTO catalog_versions(household_id) SELECT household_id FROM lessons GROUP BY household_id;
INSERT OR REPLACE INTO lesson_catalog(household_id,id,index_json,public_json,objective_kind) SELECT household_id,id,json_object('id',json_extract(lesson_json,'$.id'),'title',json_extract(lesson_json,'$.title'),'skill',json_extract(lesson_json,'$.skill'),'difficulty',json_extract(lesson_json,'$.difficulty'),'concept',json_extract(lesson_json,'$.concept'),'size',json_extract(lesson_json,'$.size'),'family_id',json_extract(lesson_json,'$.family_id'),'variant',json_extract(lesson_json,'$.variant'),'legacy',json(CASE json_type(lesson_json,'$.legacy') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'sequence',json(CASE json_type(lesson_json,'$.sequence') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE 'null' END),'source',json_object('kind',json_extract(lesson_json,'$.source.kind'),'title',json_extract(lesson_json,'$.source.title'),'problem',json_extract(lesson_json,'$.source.problem'))),(SELECT json_group_object(key,json(CASE type WHEN 'text' THEN json_quote(value) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ELSE value END)) FROM json_each(lesson_json) WHERE key IN ('id','title','prompt','hint','skill','difficulty','size','sequence','family_id','variant','source','concept','choices')),json_extract(lesson_json,'$.objective.kind') FROM lessons;
INSERT OR IGNORE INTO explanation_versions(household_id,profile_id) SELECT household_id,profile_id FROM llm_explanations GROUP BY household_id,profile_id;
