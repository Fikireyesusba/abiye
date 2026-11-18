-- Business name: "Abiye" (Amharic: አብዬ — spelling to be confirmed by the owner).
-- Only replaces the original placeholder, so it never overwrites a name an
-- administrator has already set in /admin/settings.
update public.website_settings
   set value = jsonb_set(value, '{name}', jsonb_build_object('en', 'Abiye', 'am', 'አብዬ'))
 where key = 'business'
   and value #>> '{name,en}' = '[BUSINESS NAME]';
