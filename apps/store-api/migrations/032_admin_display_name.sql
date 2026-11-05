alter table users add column display_name text
  check (display_name is null or length(display_name) between 1 and 120);
