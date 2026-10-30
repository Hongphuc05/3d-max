-- v3 P2.6: preview files are content-addressed (<sha256>.webp). A small source image yields identical sm and lg
-- bytes, and two models can share one picture, so several rows may legitimately point at the same file.
alter table model_previews drop constraint model_previews_local_path_key;
create index model_previews_local_path_idx on model_previews (local_path);
