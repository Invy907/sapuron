-- hayashi@sapuron.jp のログイン用アカウントを作成し、メール確認済みにする。
-- 既に存在する場合はパスワードを再設定し、email_confirmed_at を埋める。
-- Supabase SQL Editor で実行すること（auth スキーマへの書き込み権限が必要）。

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  rec record;
  uid uuid;
begin
  for rec in
    select * from (values
      ('hayashi@sapuron.jp', 'sapuron')
    ) as t(email, password)
  loop
    uid := null;
    select id into uid from auth.users where lower(email) = lower(rec.email);

    if uid is null then
      uid := gen_random_uuid();

      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        is_sso_user,
        is_anonymous,
        confirmation_token,
        recovery_token,
        email_change,
        email_change_token_new,
        email_change_token_current,
        reauthentication_token,
        phone_change_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        rec.email,
        crypt(rec.password, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"email_verified": true}'::jsonb,
        now(),
        now(),
        false,
        false,
        '', '', '', '', '', '', ''
      );
    else
      update auth.users
      set
        encrypted_password = crypt(rec.password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now(),
        confirmation_token = coalesce(confirmation_token, ''),
        recovery_token = coalesce(recovery_token, ''),
        email_change = coalesce(email_change, ''),
        email_change_token_new = coalesce(email_change_token_new, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        reauthentication_token = coalesce(reauthentication_token, ''),
        phone_change_token = coalesce(phone_change_token, '')
      where id = uid;
    end if;

    if not exists (
      select 1 from auth.identities where user_id = uid and provider = 'email'
    ) then
      insert into auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        uid,
        uid::text,
        jsonb_build_object(
          'sub', uid::text,
          'email', rec.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
      );
    end if;
  end loop;
end $$;

select
  email,
  email_confirmed_at is not null as confirmed,
  created_at
from auth.users
where email = 'hayashi@sapuron.jp';
