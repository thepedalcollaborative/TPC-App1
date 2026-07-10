import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, invokeEdgeFunction, Pedal, PedalPhoto } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminTab = 'stats' | 'catalog' | 'weekly' | 'users';
type CatalogView = 'edit' | 'add';

type AppStats = {
  users: number;
  new_this_week: number;
  catalog_pedals: number;
  owned_pedals: number;
  wishlist_pedals: number;
  boards: number;
  picks_this_week: number;
};

type AdminUser = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  is_premium: boolean;
  created_at: string;
  pedal_count: number;
};

type WeeklyPickRow = {
  id: string;
  brand: string;
  model: string;
  why: string;
  category: string | null;
  week_key: string;
  video_id: string | null;
  video_title: string | null;
  generated_at: string;
};

type PedalEditState = {
  brand: string;
  model: string;
  category: string;
  subcategory: string;
  description: string;
  analog: boolean;
  in_production: boolean;
  image_url: string;
  version_label: string;
  manual_url: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekKey(): string {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const BLANK_PEDAL: PedalEditState = {
  brand: '', model: '', category: '', subcategory: '',
  description: '', analog: false, in_production: true, image_url: '',
  version_label: '', manual_url: '',
};

const TABS: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'stats',   label: 'Stats',   icon: 'bar-chart-outline' },
  { key: 'catalog', label: 'Catalog', icon: 'pricetag-outline' },
  { key: 'weekly',  label: 'Weekly',  icon: 'calendar-outline' },
  { key: 'users',   label: 'Users',   icon: 'people-outline' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useStore();

  const [activeTab, setActiveTab] = useState<AdminTab>('stats');

  // Stats
  const [stats, setStats] = useState<AppStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Catalog
  const [catalogView, setCatalogView] = useState<CatalogView>('edit');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Pedal[]>([]);
  const [selectedPedal, setSelectedPedal] = useState<Pedal | null>(null);
  const [editState, setEditState] = useState<PedalEditState>(BLANK_PEDAL);
  const [addState, setAddState] = useState<PedalEditState>(BLANK_PEDAL);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pedalPhotos, setPedalPhotos] = useState<PedalPhoto[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [mirroringManual, setMirroringManual] = useState(false);

  // Weekly pick
  const [wpQuery, setWpQuery] = useState('');
  const [wpUser, setWpUser] = useState<AdminUser | null>(null);
  const [wpPick, setWpPick] = useState<WeeklyPickRow | null | undefined>(undefined);
  const [wpOverride, setWpOverride] = useState({ brand: '', model: '', why: '' });
  const [wpLoading, setWpLoading] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);

  // Users
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<AdminUser[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'stats' && !stats) loadStats();
  }, [activeTab]);

  // ─── Stats ──────────────────────────────────────────────────────────────────

  const loadStats = async () => {
    setStatsLoading(true);
    const { data, error } = await supabase.rpc('admin_get_stats');
    if (!error && data) setStats(data as AppStats);
    setStatsLoading(false);
  };

  // ─── Catalog ────────────────────────────────────────────────────────────────

  const handleCatalogSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setCatalogLoading(true);
    const { data } = await supabase
      .from('pedals')
      .select('*')
      .or(`brand.ilike.%${q}%,model.ilike.%${q}%`)
      .order('brand')
      .limit(20);
    setSearchResults((data as Pedal[]) ?? []);
    setSelectedPedal(null);
    setCatalogLoading(false);
  };

  const handleSelectPedal = (p: Pedal) => {
    setSelectedPedal(p);
    setEditState({
      brand:        p.brand,
      model:        p.model,
      category:     p.category,
      subcategory:  p.subcategory,
      description:  p.description ?? '',
      analog:       p.analog,
      in_production: p.in_production,
      image_url:    p.image_url ?? '',
      version_label: p.version_label ?? '',
      manual_url:   p.manual_url ?? '',
    });
    loadPedalPhotos(p.id);
  };

  const loadPedalPhotos = async (pedalId: string) => {
    const { data } = await supabase
      .from('pedal_photos')
      .select('*')
      .eq('pedal_id', pedalId)
      .order('position', { ascending: true });
    setPedalPhotos((data as PedalPhoto[]) ?? []);
  };

  const handleSaveEdit = async () => {
    if (!selectedPedal) return;
    if (!editState.brand.trim() || !editState.model.trim() || !editState.category.trim()) {
      Alert.alert('Missing fields', 'Brand, model, and category are required.');
      return;
    }
    const { data, error } = await supabase.rpc('admin_update_pedal', {
      p_pedal_id:      selectedPedal.id,
      p_brand:         editState.brand.trim(),
      p_model:         editState.model.trim(),
      p_category:      editState.category.trim(),
      p_subcategory:   editState.subcategory.trim(),
      p_description:   editState.description.trim() || null,
      p_analog:        editState.analog,
      p_in_production: editState.in_production,
      p_image_url:     editState.image_url.trim() || null,
      p_version_label: editState.version_label.trim() || null,
      p_manual_url:    editState.manual_url.trim() || null,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      Alert.alert('Save failed', error?.message ?? result?.error ?? 'Unknown error');
      return;
    }
    Alert.alert('Saved', `${editState.brand} ${editState.model} updated.`);
  };

  const handleAddPedal = async () => {
    if (!addState.brand.trim() || !addState.model.trim() || !addState.category.trim() || !addState.subcategory.trim()) {
      Alert.alert('Missing fields', 'Brand, model, category, and subcategory are required.');
      return;
    }
    const { data, error } = await supabase.rpc('admin_add_pedal', {
      p_brand:         addState.brand.trim(),
      p_model:         addState.model.trim(),
      p_category:      addState.category.trim(),
      p_subcategory:   addState.subcategory.trim(),
      p_description:   addState.description.trim() || null,
      p_analog:        addState.analog,
      p_in_production: addState.in_production,
      p_image_url:     addState.image_url.trim() || null,
      p_version_label: addState.version_label.trim() || null,
      p_manual_url:    addState.manual_url.trim() || null,
    });
    const result = data as { ok: boolean; error?: string } | null;
    if (error || !result?.ok) {
      Alert.alert('Failed', error?.message ?? result?.error ?? 'Unknown error');
      return;
    }
    Alert.alert('Added', `${addState.brand} ${addState.model} added to catalog.`);
    setAddState(BLANK_PEDAL);
  };

  const handleAddPhoto = async () => {
    if (!selectedPedal || !newPhotoUrl.trim()) return;
    const { data, error } = await supabase
      .from('pedal_photos')
      .insert({
        pedal_id: selectedPedal.id,
        url: newPhotoUrl.trim(),
        position: pedalPhotos.length,
      })
      .select()
      .single();
    if (error) {
      Alert.alert('Failed to add photo', error.message);
      return;
    }
    setPedalPhotos(prev => [...prev, data as PedalPhoto]);
    setNewPhotoUrl('');
  };

  const handleDeletePhoto = async (photo: PedalPhoto) => {
    const { error } = await supabase.from('pedal_photos').delete().eq('id', photo.id);
    if (error) {
      Alert.alert('Failed to delete photo', error.message);
      return;
    }
    setPedalPhotos(prev => prev.filter(p => p.id !== photo.id));
  };

  const handleMirrorManual = async () => {
    if (!selectedPedal || !editState.manual_url.trim()) return;
    setMirroringManual(true);
    const { data, error } = await invokeEdgeFunction<{ manual_url: string; manual_storage_path: string | null }>(
      'admin-mirror-manual',
      { pedal_id: selectedPedal.id, manual_url: editState.manual_url.trim() }
    );
    setMirroringManual(false);
    if (error || !data) {
      Alert.alert('Mirror failed', 'Could not download and store the manual. Try again.');
      return;
    }
    setEditState(prev => ({ ...prev, manual_url: data.manual_url }));
    Alert.alert(
      data.manual_storage_path ? 'Manual stored' : 'Manual link saved',
      data.manual_storage_path
        ? 'The PDF was downloaded and stored permanently.'
        : 'Could not download the PDF — kept the original link instead.'
    );
  };

  // ─── Weekly pick ─────────────────────────────────────────────────────────────

  const handleWpSearch = async () => {
    const q = wpQuery.trim();
    if (!q) return;
    setWpLoading(true);
    setWpUser(null);
    setWpPick(undefined);
    setShowOverrideForm(false);
    const { data: users } = await supabase.rpc('admin_search_users', { p_query: q });
    const found = ((users as AdminUser[]) ?? [])[0] ?? null;
    if (!found) {
      Alert.alert('Not found', 'No user matches that username.');
      setWpLoading(false);
      return;
    }
    setWpUser(found);
    const { data: pick } = await supabase.rpc('admin_get_weekly_pick', { p_user_id: found.id });
    setWpPick((pick as WeeklyPickRow) ?? null);
    setWpLoading(false);
  };

  const handleClearPick = () => {
    if (!wpUser) return;
    const name = wpUser.username ?? wpUser.display_name ?? 'this user';
    Alert.alert('Clear Pick', `Clear this week's pick for ${name}? They'll get a fresh one next time.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          const { data } = await supabase.rpc('admin_clear_weekly_pick', { p_user_id: wpUser.id });
          if ((data as { ok: boolean } | null)?.ok) {
            setWpPick(null);
          }
        },
      },
    ]);
  };

  const handleSetOverride = async () => {
    if (!wpUser || !wpOverride.brand.trim() || !wpOverride.model.trim() || !wpOverride.why.trim()) {
      Alert.alert('Missing', 'Brand, model, and why are all required.');
      return;
    }
    const { data } = await supabase.rpc('admin_set_weekly_pick', {
      p_user_id: wpUser.id,
      p_brand:   wpOverride.brand.trim(),
      p_model:   wpOverride.model.trim(),
      p_why:     wpOverride.why.trim(),
    });
    if ((data as { ok: boolean } | null)?.ok) {
      setWpOverride({ brand: '', model: '', why: '' });
      setShowOverrideForm(false);
      const { data: pick } = await supabase.rpc('admin_get_weekly_pick', { p_user_id: wpUser.id });
      setWpPick((pick as WeeklyPickRow) ?? null);
    }
  };

  // ─── Users ───────────────────────────────────────────────────────────────────

  const handleUserSearch = async () => {
    const q = userQuery.trim();
    if (!q) return;
    setUserLoading(true);
    const { data } = await supabase.rpc('admin_search_users', { p_query: q });
    setUserResults((data as AdminUser[]) ?? []);
    setExpandedUserId(null);
    setUserLoading(false);
  };

  const handleToggleFlag = (user: AdminUser, field: 'is_admin' | 'is_premium', value: boolean) => {
    const label = field === 'is_admin' ? 'admin' : 'Pro';
    const action = value ? 'Grant' : 'Revoke';
    Alert.alert(`${action} ${label}?`, `${action} ${label} access for ${user.username ?? user.display_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action, onPress: async () => {
          const { data } = await supabase.rpc('admin_set_user_flag', {
            p_user_id: user.id,
            p_field:   field,
            p_value:   value,
          });
          const result = data as { ok: boolean; error?: string } | null;
          if (!result?.ok) {
            Alert.alert('Failed', result?.error ?? 'Unknown error');
            return;
          }
          setUserResults(prev => prev.map(u => u.id === user.id ? { ...u, [field]: value } : u));
        },
      },
    ]);
  };

  // ─── Access guard ────────────────────────────────────────────────────────────

  if (!profile?.is_admin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.deniedTitle}>Admin access required</Text>
        <Text style={styles.deniedSub}>This screen is only available to admins.</Text>
      </View>
    );
  }

  // ─── Tab renderers ────────────────────────────────────────────────────────────

  const renderStats = () => (
    <View style={styles.tabContent}>
      {statsLoading && <ActivityIndicator color={colors.teal} style={styles.loader} />}
      {!statsLoading && !stats && (
        <TouchableOpacity style={styles.retryBtn} onPress={loadStats}>
          <Text style={styles.retryText}>Load Stats</Text>
        </TouchableOpacity>
      )}
      {stats && (
        <>
          <View style={styles.statsGrid}>
            <StatCard label="Total Users"    value={stats.users} />
            <StatCard label="New This Week"  value={stats.new_this_week} accent />
            <StatCard label="Catalog Pedals" value={stats.catalog_pedals} />
            <StatCard label="Owned Pedals"   value={stats.owned_pedals} />
            <StatCard label="Wishlisted"     value={stats.wishlist_pedals} />
            <StatCard label="Boards"         value={stats.boards} />
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>This Week</Text>
            <View style={styles.bigStatRow}>
              <Ionicons name="calendar-outline" size={20} color={colors.teal} />
              <Text style={styles.bigStatValue}>{stats.picks_this_week}</Text>
              <Text style={styles.bigStatLabel}>weekly picks generated ({getWeekKey()})</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => { setStats(null); loadStats(); }}>
            <Ionicons name="refresh-outline" size={14} color={colors.teal} />
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderCatalog = () => (
    <View style={styles.tabContent}>
      <View style={styles.subTabRow}>
        {(['edit', 'add'] as CatalogView[]).map(v => (
          <TouchableOpacity
            key={v}
            style={[styles.subTab, catalogView === v && styles.subTabActive]}
            onPress={() => setCatalogView(v)}
          >
            <Text style={[styles.subTabText, catalogView === v && styles.subTabTextActive]}>
              {v === 'edit' ? 'Edit Existing' : 'Add New'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {catalogView === 'edit' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Find Pedal</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search brand or model"
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleCatalogSearch}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={handleCatalogSearch} activeOpacity={0.8}>
                {catalogLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.searchBtnText}>Go</Text>}
              </TouchableOpacity>
            </View>
            {searchResults.length > 0 && (
              <View style={styles.results}>
                {searchResults.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.resultRow, selectedPedal?.id === p.id && styles.resultRowSelected]}
                    onPress={() => handleSelectPedal(p)}
                  >
                    <Text style={styles.resultBrand}>{p.brand}</Text>
                    <Text style={styles.resultModel}>{p.model}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {selectedPedal && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Edit Pedal</Text>
              <PedalForm state={editState} onChange={setEditState} />
              {editState.image_url ? (
                <Image source={{ uri: editState.image_url }} style={styles.preview} resizeMode="contain" />
              ) : null}
              {editState.manual_url.trim() ? (
                <TouchableOpacity
                  style={styles.mirrorBtn}
                  onPress={handleMirrorManual}
                  disabled={mirroringManual}
                  activeOpacity={0.85}
                >
                  {mirroringManual
                    ? <ActivityIndicator color={colors.teal} size="small" />
                    : <Text style={styles.mirrorBtnText}>Download &amp; Store Manual PDF</Text>}
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </TouchableOpacity>

              <Text style={[styles.sectionLabel, styles.photosLabel]}>Product Photos</Text>
              {pedalPhotos.map(photo => (
                <View key={photo.id} style={styles.photoRow}>
                  <Image source={{ uri: photo.url }} style={styles.photoThumb} resizeMode="cover" />
                  <Text style={styles.photoUrl} numberOfLines={1}>{photo.url}</Text>
                  <TouchableOpacity onPress={() => handleDeletePhoto(photo)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={18} color={colors.rose} />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Add photo URL"
                  placeholderTextColor={colors.textMuted}
                  value={newPhotoUrl}
                  onChangeText={setNewPhotoUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.searchBtn} onPress={handleAddPhoto} activeOpacity={0.8}>
                  <Text style={styles.searchBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Add New Pedal</Text>
          <PedalForm state={addState} onChange={setAddState} />
          {addState.image_url ? (
            <Image source={{ uri: addState.image_url }} style={styles.preview} resizeMode="contain" />
          ) : null}
          <TouchableOpacity style={styles.saveBtn} onPress={handleAddPedal} activeOpacity={0.85}>
            <Text style={styles.saveBtnText}>Add to Catalog</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderWeekly = () => (
    <View style={styles.tabContent}>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Find User</Text>
        <View style={styles.searchRow}>
          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            value={wpQuery}
            onChangeText={setWpQuery}
            onSubmitEditing={handleWpSearch}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleWpSearch} activeOpacity={0.8}>
            {wpLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.searchBtnText}>Go</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {wpUser && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{wpUser.username ?? wpUser.display_name}</Text>
          <Text style={styles.metaText}>{getWeekKey()}</Text>

          {wpPick === undefined && <ActivityIndicator color={colors.teal} style={styles.loader} />}

          {wpPick === null && (
            <Text style={styles.emptyText}>No pick generated this week yet.</Text>
          )}

          {wpPick && (
            <View style={styles.pickCard}>
              <Text style={styles.pickBrand}>{wpPick.brand}</Text>
              <Text style={styles.pickModel}>{wpPick.model}</Text>
              <Text style={styles.pickWhy}>{wpPick.why}</Text>
              {wpPick.video_title && (
                <Text style={styles.metaText}>Video: {wpPick.video_title}</Text>
              )}
            </View>
          )}

          <View style={styles.actionRow}>
            {wpPick && (
              <TouchableOpacity style={styles.dangerBtn} onPress={handleClearPick} activeOpacity={0.8}>
                <Text style={styles.dangerBtnText}>Clear Pick</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.outlineBtn, { flex: 1 }]}
              onPress={() => setShowOverrideForm(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.outlineBtnText}>
                {showOverrideForm ? 'Cancel Override' : 'Set Override'}
              </Text>
            </TouchableOpacity>
          </View>

          {showOverrideForm && (
            <View style={styles.overrideForm}>
              <TextInput
                style={styles.fieldInput}
                placeholder="Brand"
                placeholderTextColor={colors.textMuted}
                value={wpOverride.brand}
                onChangeText={v => setWpOverride(s => ({ ...s, brand: v }))}
              />
              <TextInput
                style={styles.fieldInput}
                placeholder="Model"
                placeholderTextColor={colors.textMuted}
                value={wpOverride.model}
                onChangeText={v => setWpOverride(s => ({ ...s, model: v }))}
              />
              <TextInput
                style={[styles.fieldInput, styles.fieldInputMulti]}
                placeholder="Why (2–3 sentences)"
                placeholderTextColor={colors.textMuted}
                value={wpOverride.why}
                onChangeText={v => setWpOverride(s => ({ ...s, why: v }))}
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handleSetOverride} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Save Override</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );

  const renderUsers = () => (
    <View style={styles.tabContent}>
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Search Users</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Username or display name"
            placeholderTextColor={colors.textMuted}
            value={userQuery}
            onChangeText={setUserQuery}
            onSubmitEditing={handleUserSearch}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleUserSearch} activeOpacity={0.8}>
            {userLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.searchBtnText}>Go</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {userResults.map(user => (
        <View key={user.id} style={styles.card}>
          <TouchableOpacity
            onPress={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
            activeOpacity={0.7}
          >
            <View style={styles.userRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{user.username ?? '(no username)'}</Text>
                {user.display_name ? (
                  <Text style={styles.userMeta}>{user.display_name}</Text>
                ) : null}
                <Text style={styles.userMeta}>
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.userBadges}>
                {user.is_admin && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Admin</Text>
                  </View>
                )}
                {user.is_premium && (
                  <View style={[styles.badge, styles.badgePro]}>
                    <Text style={styles.badgeText}>Pro</Text>
                  </View>
                )}
              </View>
              <Ionicons
                name={expandedUserId === user.id ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </TouchableOpacity>

          {expandedUserId === user.id && (
            <View style={styles.userExpanded}>
              <Text style={styles.metaText}>{user.pedal_count} pedals owned</Text>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Admin access</Text>
                <Switch
                  value={user.is_admin}
                  onValueChange={val => handleToggleFlag(user, 'is_admin', val)}
                  trackColor={{ false: colors.border, true: colors.teal }}
                  thumbColor="#fff"
                />
              </View>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Pro access</Text>
                <Switch
                  value={user.is_premium}
                  onValueChange={val => handleToggleFlag(user, 'is_premium', val)}
                  trackColor={{ false: colors.border, true: colors.teal }}
                  thumbColor="#fff"
                />
              </View>
            </View>
          )}
        </View>
      ))}

      {userResults.length === 0 && userQuery.trim() && !userLoading && (
        <Text style={[styles.emptyText, { marginTop: 24, textAlign: 'center' }]}>No users found.</Text>
      )}
    </View>
  );

  // ─── Root render ──────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <LinearGradient colors={gradients.header} style={styles.header}>
        <Text style={styles.headerTitle}>Admin Console</Text>
        <Text style={styles.headerSub}>Manage the app</Text>
      </LinearGradient>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBarWrapper}
        contentContainerStyle={styles.tabBar}
      >
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabPill, activeTab === tab.key && styles.tabPillActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={tab.icon}
              size={14}
              color={activeTab === tab.key ? '#fff' : colors.textMuted}
            />
            <Text style={[styles.tabPillText, activeTab === tab.key && styles.tabPillTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeTab === 'stats'   && renderStats()}
      {activeTab === 'catalog' && renderCatalog()}
      {activeTab === 'weekly'  && renderWeekly()}
      {activeTab === 'users'   && renderUsers()}
    </ScrollView>
  );
}

// ─── PedalForm ────────────────────────────────────────────────────────────────

function PedalForm({
  state,
  onChange,
}: {
  state: PedalEditState;
  onChange: (s: PedalEditState) => void;
}) {
  const setStr = (key: keyof PedalEditState) => (val: string) =>
    onChange({ ...state, [key]: val });
  const setBool = (key: keyof PedalEditState) => (val: boolean) =>
    onChange({ ...state, [key]: val });

  return (
    <View style={pfStyles.form}>
      <FormField label="Brand *"       value={state.brand}       onChangeText={setStr('brand')}       placeholder="e.g. Boss" />
      <FormField label="Model *"       value={state.model}       onChangeText={setStr('model')}       placeholder="e.g. DS-1" />
      <FormField label="Category *"    value={state.category}    onChangeText={setStr('category')}    placeholder="e.g. Distortion" />
      <FormField label="Subcategory *" value={state.subcategory} onChangeText={setStr('subcategory')} placeholder="e.g. Classic Distortion" />
      <FormField label="Description"   value={state.description} onChangeText={setStr('description')} placeholder="Brief description" multiline />
      <FormField label="Version"       value={state.version_label} onChangeText={setStr('version_label')} placeholder="e.g. MKII, v3, Firmware 2.1" />
      <FormField label="Image URL"     value={state.image_url}   onChangeText={setStr('image_url')}   placeholder="https://..." noCapitalize />
      <FormField label="Manual URL"    value={state.manual_url}  onChangeText={setStr('manual_url')}  placeholder="https://... (PDF link)" noCapitalize />
      <View style={pfStyles.switchRow}>
        <Text style={pfStyles.switchLabel}>Analog</Text>
        <Switch
          value={state.analog}
          onValueChange={setBool('analog')}
          trackColor={{ false: colors.border, true: colors.teal }}
          thumbColor="#fff"
        />
      </View>
      <View style={pfStyles.switchRow}>
        <Text style={pfStyles.switchLabel}>In Production</Text>
        <Switch
          value={state.in_production}
          onValueChange={setBool('in_production')}
          trackColor={{ false: colors.border, true: colors.teal }}
          thumbColor="#fff"
        />
      </View>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  noCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  noCapitalize?: boolean;
}) {
  return (
    <View style={pfStyles.field}>
      <Text style={pfStyles.fieldLabel}>{label}</Text>
      <TextInput
        style={[pfStyles.fieldInput, multiline && pfStyles.fieldInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        autoCapitalize={noCapitalize ? 'none' : 'words'}
        autoCorrect={false}
      />
    </View>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <View style={[scStyles.card, accent && scStyles.cardAccent]}>
      <Text style={[scStyles.value, accent && scStyles.valueAccent]}>{value.toLocaleString()}</Text>
      <Text style={scStyles.label}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  headerSub: {
    marginTop: 6,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },

  // Tab bar
  tabBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabPillActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  tabPillText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  tabPillTextActive: {
    color: '#fff',
  },

  // Tab content
  tabContent: {
    paddingTop: spacing.base,
  },
  subTabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  subTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
  },
  subTabActive: {
    backgroundColor: colors.teal,
  },
  subTabText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  subTabTextActive: {
    color: '#fff',
  },

  // Card
  card: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    height: 44,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  searchBtn: {
    backgroundColor: colors.teal,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    minWidth: 36,
    alignItems: 'center',
  },
  searchBtnText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },

  // Results list
  results: {
    gap: 4,
  },
  resultRow: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: radius.sm,
  },
  resultRowSelected: {
    backgroundColor: colors.teal + '15',
  },
  resultBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  resultModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bigStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bigStatValue: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  bigStatLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    flex: 1,
  },

  // Refresh / retry
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginBottom: spacing.base,
    padding: spacing.sm,
  },
  refreshText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  retryBtn: {
    alignSelf: 'center',
    marginTop: 24,
    padding: spacing.base,
    backgroundColor: colors.teal,
    borderRadius: radius.lg,
  },
  retryText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  loader: {
    marginVertical: spacing.base,
  },

  // Buttons
  saveBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  saveBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  mirrorBtn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  mirrorBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  photosLabel: {
    marginTop: spacing.base,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  photoThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  photoUrl: {
    flex: 1,
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
  },
  dangerBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error ?? '#e74c3c',
    alignItems: 'center',
  },
  dangerBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.error ?? '#e74c3c',
  },
  outlineBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  outlineBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Weekly pick
  pickCard: {
    gap: 4,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  pickModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  pickWhy: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
  },
  overrideForm: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 42,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  fieldInputMulti: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },

  // Users
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userName: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  userMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 1,
  },
  userBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.teal + '20',
  },
  badgePro: {
    backgroundColor: '#f59e0b20',
  },
  badgeText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  userExpanded: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },

  // Shared
  metaText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  emptyText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },

  // Access denied
  deniedTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 40,
  },
  deniedSub: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

const pfStyles = StyleSheet.create({
  form: {
    gap: spacing.sm,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 42,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  fieldInputMulti: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
});

const scStyles = StyleSheet.create({
  card: {
    width: '47%',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  cardAccent: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '10',
  },
  value: {
    fontSize: 22,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  valueAccent: {
    color: colors.teal,
  },
  label: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
});
