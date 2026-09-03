-- Preserve the historical Full preset while separating destructive media
-- deletion from upload/read access. Requiring every old Full scope avoids
-- granting deletion to a custom token merely because it could archive posts.
UPDATE api_keys
SET scopes_json = json_insert(scopes_json, '$[#]', 'assets:delete')
WHERE json_valid(scopes_json)
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'sites:read'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'posts:read'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'posts:create'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'posts:update'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'posts:publish'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'posts:archive'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'assets:write'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'activity:read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(api_keys.scopes_json) WHERE value = 'assets:delete'
  );
