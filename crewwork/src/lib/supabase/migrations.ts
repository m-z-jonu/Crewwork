// Core SQL table definitions + RLS policies + triggers
// CrewWork — local-first architecture (9 tables)

export const migrations: string[] = [
  // 001 - Profiles
  `CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    display_name text NOT NULL DEFAULT 'User',
    avatar_url text,
    status_emoji text,
    status_text text,
    is_online boolean DEFAULT false,
    last_seen_at timestamptz,
    sync_started_at timestamptz,
    created_at timestamptz DEFAULT now(),
    -- E2EE fields
    public_key text,                    -- Identity public key (base64)
    prekey_bundle jsonb,                -- Prekey bundle for X3DH
    identity_backup jsonb               -- Encrypted identity key for multi-device sync
  );`,

  // 002 - Workspaces
  `CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text UNIQUE NOT NULL,
    icon_url text,
    workspace_type text DEFAULT 'business',
    personal_name text,
    calls_enabled boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  );`,

  // 003 - Workspace Members
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
    profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member',
    joined_at timestamptz DEFAULT now(),
    PRIMARY KEY (workspace_id, profile_id)
  );`,

  // 004 - Channels
  `CREATE TABLE IF NOT EXISTS channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    topic text,
    is_private boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    created_by uuid REFERENCES profiles(id),
    created_at timestamptz DEFAULT now()
  );`,

  // 005 - Channel Members
  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
    profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
    role text DEFAULT 'member',
    notification_pref text DEFAULT 'all',
    joined_at timestamptz DEFAULT now(),
    PRIMARY KEY (channel_id, profile_id)
  );`,

  // 006 - Messages
  `CREATE TABLE IF NOT EXISTS messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    content text NOT NULL DEFAULT '',
    parent_id uuid REFERENCES messages(id) ON DELETE SET NULL,
    thread_reply_count int DEFAULT 0,
    is_edited boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );`,

  // 008 - File Attachments
  `CREATE TABLE IF NOT EXISTS file_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name text NOT NULL,
    file_url text NOT NULL,
    file_size bigint,
    mime_type text,
    created_at timestamptz DEFAULT now()
  );`,

  // 040 - Todos (Kanban board)
  `CREATE TABLE IF NOT EXISTS todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'TODO',
    priority TEXT DEFAULT 'medium',
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    due_date TIMESTAMPTZ,
    position INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );`,

  // 041 - Contacts
  `CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'accepted',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, contact_id)
  );`,

  // 050 - Prekeys (one-time prekeys for X3DH)
  `CREATE TABLE IF NOT EXISTS prekeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    public_key text NOT NULL,
    used boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  );`,

  // RLS Policies + Triggers
  `-- Nuclear cleanup: drop ALL existing policies
  DO $cleanup$
  DECLARE
    r RECORD;
  BEGIN
    FOR r IN (
      SELECT schemaname, tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
    )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
  END
  $cleanup$;

  -- Enable RLS on all tables
  ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
  ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
  ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
  ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
  ALTER TABLE file_attachments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE prekeys ENABLE ROW LEVEL SECURITY;

  -- SECURITY DEFINER helpers (bypass RLS to prevent infinite recursion)
  CREATE OR REPLACE FUNCTION get_my_workspace_ids()
  RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
  AS $fn$ SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid(); $fn$;

  CREATE OR REPLACE FUNCTION get_my_admin_workspace_ids()
  RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
  AS $fn$ SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid() AND role IN ('owner', 'admin'); $fn$;

  CREATE OR REPLACE FUNCTION get_my_channel_ids()
  RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
  AS $fn$ SELECT channel_id FROM channel_members WHERE profile_id = auth.uid(); $fn$;

  -- Profiles (only visible to co-workers in shared workspaces, or self)
  CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT wm2.profile_id FROM workspace_members wm1
      JOIN workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.profile_id = auth.uid()
    )
  );
  CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
  CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

  -- Workspaces
  CREATE POLICY "workspaces_select" ON workspaces FOR SELECT USING (id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "workspaces_insert" ON workspaces FOR INSERT WITH CHECK (true);
  CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE USING (id IN (SELECT get_my_admin_workspace_ids()));

  -- Workspace Members (insert restricted to self + workspace must exist)
  CREATE POLICY "wm_select" ON workspace_members FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "wm_insert" ON workspace_members FOR INSERT WITH CHECK (profile_id = auth.uid());
  CREATE POLICY "wm_delete" ON workspace_members FOR DELETE USING (workspace_id IN (SELECT get_my_admin_workspace_ids()) OR profile_id = auth.uid());

  -- Channels
  CREATE POLICY "channels_select" ON channels FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "channels_insert" ON channels FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "channels_update" ON channels FOR UPDATE USING (workspace_id IN (SELECT get_my_workspace_ids()));

  -- Channel Members (insert restricted to own workspace channels)
  CREATE POLICY "cm_select" ON channel_members FOR SELECT USING (channel_id IN (SELECT get_my_channel_ids()) OR profile_id = auth.uid());
  CREATE POLICY "cm_insert" ON channel_members FOR INSERT WITH CHECK (
    channel_id IN (SELECT id FROM channels WHERE workspace_id IN (SELECT get_my_workspace_ids()))
    AND (
      profile_id = auth.uid()
      OR channel_id IN (SELECT id FROM channels WHERE created_by = auth.uid())
    )
  );
  CREATE POLICY "cm_delete" ON channel_members FOR DELETE USING (profile_id = auth.uid() OR channel_id IN (SELECT c.id FROM channels c WHERE c.workspace_id IN (SELECT get_my_admin_workspace_ids())));

  -- Messages
  CREATE POLICY "msg_select" ON messages FOR SELECT USING (channel_id IN (SELECT get_my_channel_ids()));
  CREATE POLICY "msg_insert" ON messages FOR INSERT WITH CHECK (channel_id IN (SELECT get_my_channel_ids()));
  CREATE POLICY "msg_update" ON messages FOR UPDATE USING (sender_id = auth.uid());
  CREATE POLICY "msg_delete" ON messages FOR DELETE USING (sender_id = auth.uid());

  -- File Attachments (insert restricted to messages in own channels)
  CREATE POLICY "fa_select" ON file_attachments FOR SELECT USING (message_id IN (SELECT id FROM messages WHERE channel_id IN (SELECT get_my_channel_ids())));
  CREATE POLICY "fa_insert" ON file_attachments FOR INSERT WITH CHECK (message_id IN (SELECT id FROM messages WHERE channel_id IN (SELECT get_my_channel_ids())));

  -- Todos
  CREATE POLICY "todos_select" ON todos FOR SELECT USING (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "todos_insert" ON todos FOR INSERT WITH CHECK (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "todos_update" ON todos FOR UPDATE USING (workspace_id IN (SELECT get_my_workspace_ids()));
  CREATE POLICY "todos_delete" ON todos FOR DELETE USING (workspace_id IN (SELECT get_my_workspace_ids()));

  -- Contacts
  CREATE POLICY "contacts_select" ON contacts FOR SELECT USING ((user_id = (select auth.uid())) OR (contact_id = (select auth.uid())));
  CREATE POLICY "contacts_insert" ON contacts FOR INSERT WITH CHECK (user_id = auth.uid());
  CREATE POLICY "contacts_delete" ON contacts FOR DELETE USING (user_id = auth.uid());
  CREATE POLICY "contacts_update" ON contacts FOR UPDATE USING (user_id = auth.uid());

  -- Prekeys (one-time prekeys for X3DH)
  CREATE POLICY "prekeys_select" ON prekeys FOR SELECT USING (true);
  CREATE POLICY "prekeys_insert" ON prekeys FOR INSERT WITH CHECK (auth.uid() = user_id);
  CREATE POLICY "prekeys_update" ON prekeys FOR UPDATE USING (auth.uid() = user_id);
  CREATE POLICY "prekeys_delete" ON prekeys FOR DELETE USING (auth.uid() = user_id);

  -- Index for efficient prekey lookups
  CREATE INDEX IF NOT EXISTS idx_prekeys_user_used ON prekeys (user_id, used) WHERE used = false;

  -- Trigger: auto-create profile on signup
  CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $fn$
  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name;
    RETURN NEW;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

  -- Trigger: update thread reply count
  CREATE OR REPLACE FUNCTION update_thread_reply_count()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $fn$
  BEGIN
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE messages SET thread_reply_count = (
        SELECT count(*) FROM messages WHERE parent_id = NEW.parent_id
      ) WHERE id = NEW.parent_id;
    END IF;
    RETURN NEW;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS on_message_reply ON messages;
  CREATE TRIGGER on_message_reply
    AFTER INSERT ON messages
    FOR EACH ROW
    WHEN (NEW.parent_id IS NOT NULL)
    EXECUTE FUNCTION update_thread_reply_count();`,

  // Realtime Setup
  `DO $$
  BEGIN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE channels; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE channel_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE profiles; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE todos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END
  $$;`,

  // Replica identity full for channel_members (needed for DELETE events to include old row data)
  `ALTER TABLE channel_members REPLICA IDENTITY FULL;`,

  // Cleanup orphaned auth users
  `DELETE FROM auth.users
  WHERE id NOT IN (SELECT id FROM public.profiles)
  AND created_at < now() - interval '1 minute';`,

  // AI Agent profile (fixed UUID, no auth user)
  `INSERT INTO profiles (id, email, display_name, avatar_url, is_online, created_at)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'ai@crewwork.app',
    'CrewWork AI',
    NULL,
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = 'CrewWork AI',
    is_online = true;`,

  // Channel keys sync column for multi-device support
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS channel_keys_sync jsonb;`,

  // 060 - Per-channel calls_enabled
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS calls_enabled boolean DEFAULT true;`,

  // 061 - Allow profile search for contact discovery
  `DROP POLICY IF EXISTS profiles_select ON profiles; CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);`,
]

export const REQUIRED_TABLES = [
  'profiles', 'workspaces', 'workspace_members',
  'channels', 'channel_members', 'messages',
  'file_attachments', 'todos', 'contacts', 'prekeys',
]
