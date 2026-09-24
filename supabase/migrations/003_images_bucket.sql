-- 003 · a public Storage bucket for question images: WebP only, up to 3 MB each.
-- (api/images.js also creates it on the first upload, so this is for fresh installs and the record.)
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assessment-images', 'assessment-images', true, 3145728, array['image/webp'])
on conflict (id) do nothing;

insert into public.assessment_migrations (name) values ('003_images_bucket') on conflict do nothing;
commit;
