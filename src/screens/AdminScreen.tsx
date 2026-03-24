import React, { useState } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, Pedal } from '../lib/supabase';

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pedal[]>([]);
  const [selected, setSelected] = useState<Pedal | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    const safe = query.trim();
    if (!safe) return;
    setLoading(true);
    const { data } = await supabase
      .from('pedals')
      .select('*')
      .or(`brand.ilike.%${safe}%,model.ilike.%${safe}%`)
      .order('brand')
      .limit(20);
    setResults((data as Pedal[]) ?? []);
    setLoading(false);
  };

  const handleSelect = (p: Pedal) => {
    setSelected(p);
    setImageUrl(p.image_url ?? '');
  };

  const handleSave = async () => {
    if (!selected) return;
    const url = imageUrl.trim();
    if (!url) {
      Alert.alert('Missing URL', 'Paste a manufacturer image URL first.');
      return;
    }
    const { error } = await supabase
      .from('pedals')
      .update({ image_url: url })
      .eq('id', selected.id);
    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }
    Alert.alert('Saved', 'Official image updated.');
    setSelected({ ...selected, image_url: url });
  };

  if (!profile?.is_admin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.deniedTitle}>Admin access required</Text>
        <Text style={styles.deniedSub}>This screen is only available to admins.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={gradients.header} style={styles.header}>
        <Text style={styles.headerTitle}>Admin Console</Text>
        <Text style={styles.headerSub}>Set official manufacturer images</Text>
      </LinearGradient>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Find Pedal</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search brand or model"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} activeOpacity={0.8}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchBtnText}>Go</Text>}
          </TouchableOpacity>
        </View>

        {results.length > 0 && (
          <View style={styles.results}>
            {results.map(p => (
              <TouchableOpacity key={p.id} style={styles.resultRow} onPress={() => handleSelect(p)}>
                <Text style={styles.resultBrand}>{p.brand}</Text>
                <Text style={styles.resultModel}>{p.model}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {selected && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Official Image</Text>
          <Text style={styles.selectedTitle}>{selected.brand} {selected.model}</Text>
          {selected.image_url ? (
            <Image source={{ uri: selected.image_url }} style={styles.preview} />
          ) : (
            <View style={styles.previewPlaceholder}>
              <Ionicons name="image-outline" size={22} color={colors.textMuted} />
              <Text style={styles.previewPlaceholderText}>No image set</Text>
            </View>
          )}
          <TextInput
            style={styles.urlInput}
            placeholder="Paste manufacturer image URL"
            placeholderTextColor={colors.textMuted}
            value={imageUrl}
            onChangeText={setImageUrl}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
            <Text style={styles.saveBtnText}>Save Official Image</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 32,
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
  card: {
    marginHorizontal: spacing.base,
    marginTop: spacing.lg,
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
  },
  searchBtnText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  results: {
    gap: 6,
  },
  resultRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  selectedTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
  },
  previewPlaceholder: {
    height: 180,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  previewPlaceholderText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  urlInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 44,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  saveBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
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
