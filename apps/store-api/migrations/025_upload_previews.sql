-- D29: anh preview do admin tai len VPS (source 'UPLOAD'); Drive chi cung cap file nen. Ghep cap theo models.stem (ten file da chuan hoa).
-- models.drive_category_id = danh muc cua file nen tren Drive; khac category_id (danh muc cua anh) = "lech danh muc".
alter table models add column stem text check (stem is null or length(stem) between 1 and 300);
alter table models add column drive_category_id uuid references categories(id) on delete set null;
create unique index models_stem_idx on models (stem) where stem is not null;

alter table model_previews drop constraint model_previews_source_check;
alter table model_previews add constraint model_previews_source_check check (source in ('DRIVE_IMAGE','ARCHIVE_ENTRY','UPLOAD'));

-- Muc "can duyet" co the khong thuoc nguon Drive nao (xung dot ten khi tai anh len).
alter table review_items alter column source_id drop not null;

-- Anh tai tu Drive khong con duoc dung (D29). Xoa HANG DB; file .webp tren dia giu nguyen (don tay sau, xem docs).
-- Model cu giu nguyen (stem NULL): lan quet Drive ke tiep nhan lai chung theo drive_file_id. Chua co anh upload thi chung chi hien o admin.
delete from model_previews where source = 'DRIVE_IMAGE';
